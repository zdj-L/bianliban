use std::sync::MutexGuard;
use std::time::Duration;

use image::RgbaImage;
use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::AppState;
use crate::capture::{self, CaptureMonitor};
use crate::db::{CardRow, NewImage};
use crate::images::{self, SavedImage};
use crate::names::{is_sequence_prefix, next_sequence_name};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDto {
    pub id: String,
    pub kind: String,
    pub title: Option<String>,
    pub body: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub thumb_png_base64: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowDto {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub collapsed: bool,
    pub chip_x: Option<f64>,
    pub chip_y: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardState {
    pub window: Option<WindowDto>,
    pub cards: Vec<CardDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedDto {
    pub name: String,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub cards: Vec<CardDto>,
    pub skipped: Vec<SkippedDto>,
    pub added: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteOutcome {
    pub added: bool,
    pub cards: Vec<CardDto>,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDto {
    pub png_base64: String,
}

#[tauri::command]
pub fn get_state(state: State<'_, AppState>) -> Result<BoardState, String> {
    let image_dir = state.image_dir.clone();
    let db = lock(&state)?;
    let window = db.window()?.map(|saved| WindowDto {
        x: saved.x,
        y: saved.y,
        width: saved.width,
        height: saved.height,
        collapsed: saved.collapsed,
        chip_x: saved.chip_x,
        chip_y: saved.chip_y,
    });
    let cards = to_dtos(&image_dir, db.list_cards()?);
    Ok(BoardState { window, cards })
}

#[tauri::command]
pub fn next_name(
    state: State<'_, AppState>,
    prefix: String,
    except_id: Option<String>,
) -> Result<String, String> {
    if !is_sequence_prefix(&prefix) {
        return Err("名称前缀无效".into());
    }
    let db = lock(&state)?;
    let titles = db.titles_except(except_id.as_deref())?;
    Ok(next_sequence_name(&titles, &prefix))
}

#[tauri::command]
pub fn create_text_card(
    state: State<'_, AppState>,
    title: String,
    body: String,
) -> Result<Vec<CardDto>, String> {
    let image_dir = state.image_dir.clone();
    let mut db = lock(&state)?;
    db.create_text(&title, &body)?;
    Ok(to_dtos(&image_dir, db.list_cards()?))
}

#[tauri::command]
pub fn update_text_card(
    state: State<'_, AppState>,
    id: String,
    body: String,
) -> Result<Vec<CardDto>, String> {
    let image_dir = state.image_dir.clone();
    let mut db = lock(&state)?;
    db.update_body(&id, &body)?;
    Ok(to_dtos(&image_dir, db.list_cards()?))
}

#[tauri::command]
pub fn rename_card(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<Vec<CardDto>, String> {
    let image_dir = state.image_dir.clone();
    let mut db = lock(&state)?;
    db.rename(&id, &title)?;
    Ok(to_dtos(&image_dir, db.list_cards()?))
}

#[tauri::command]
pub fn delete_card(state: State<'_, AppState>, id: String) -> Result<Vec<CardDto>, String> {
    let image_dir = state.image_dir.clone();
    let mut db = lock(&state)?;
    let removed = db.delete(&id)?;
    let cards = to_dtos(&image_dir, db.list_cards()?);
    drop(db);
    images::remove_files(
        &image_dir,
        removed.image_file.as_deref().unwrap_or(""),
        removed.thumb_file.as_deref().unwrap_or(""),
    );
    Ok(cards)
}

#[tauri::command]
pub fn move_card_to_top(state: State<'_, AppState>, id: String) -> Result<Vec<CardDto>, String> {
    let image_dir = state.image_dir.clone();
    let mut db = lock(&state)?;
    db.move_to_top(&id)?;
    Ok(to_dtos(&image_dir, db.list_cards()?))
}

#[tauri::command]
pub fn save_window(
    state: State<'_, AppState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    collapsed: bool,
    chip_x: Option<f64>,
    chip_y: Option<f64>,
) -> Result<(), String> {
    let db = lock(&state)?;
    db.save_window(x, y, width, height, collapsed, chip_x, chip_y)
}

/// 一次设定窗口外框的位置和尺寸（物理像素），避免先改大小再改位置造成抖动。
#[tauri::command]
pub fn set_outer_geometry(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    if width <= 0 || height <= 0 {
        return Err("无效的窗口尺寸".into());
    }
    #[cfg(windows)]
    {
        set_outer_geometry_win(&window, x, y, width, height)
    }
    #[cfg(not(windows))]
    {
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: width as u32,
                height: height as u32,
            }))
            .map_err(|e| e.to_string())?;
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub fn import_image_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ImportOutcome, String> {
    let image_dir = state.image_dir.clone();
    let prepared = images::import_paths(&image_dir, &paths)?;
    let saved = prepared.saved;
    let skipped = prepared
        .skipped
        .into_iter()
        .map(|item| SkippedDto {
            name: item.name,
            reason: item.reason,
        })
        .collect::<Vec<_>>();
    let added = saved.len();
    let mut db = lock(&state)?;
    if let Err(err) = db.insert_images(&saved_as_new(&saved), "图片") {
        drop(db);
        for image in &saved {
            images::remove_files(&image_dir, &image.image_file, &image.thumb_file);
        }
        return Err(err);
    }
    let cards = to_dtos(&image_dir, db.list_cards()?);
    Ok(ImportOutcome {
        cards,
        skipped,
        added,
    })
}

#[tauri::command]
pub fn paste_image(app: AppHandle, state: State<'_, AppState>) -> Result<PasteOutcome, String> {
    let image = match read_clipboard_image(&app) {
        Ok(Some(image)) => image,
        Ok(None) => {
            return Ok(PasteOutcome {
                added: false,
                cards: Vec::new(),
                message: "剪贴板里没有图片。".into(),
            });
        }
        Err(message) => {
            return Ok(PasteOutcome {
                added: false,
                cards: Vec::new(),
                message,
            });
        }
    };
    match store_image(&state, &image, "图片") {
        Ok(cards) => Ok(PasteOutcome {
            added: true,
            cards,
            message: "已添加图片。".into(),
        }),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub fn clipboard_text(app: AppHandle) -> Result<String, String> {
    match app.clipboard().read_text() {
        Ok(text) => Ok(text),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
pub fn card_image(state: State<'_, AppState>, id: String) -> Result<ImageDto, String> {
    let image_dir = state.image_dir.clone();
    let db = lock(&state)?;
    let card = db.get(&id)?;
    if card.kind != "image" {
        return Err("这不是图片".into());
    }
    let name = card
        .image_file
        .ok_or_else(|| "图片文件不在了".to_string())?;
    let png_base64 =
        images::read_base64(&image_dir, &name).ok_or_else(|| "图片文件不在了".to_string())?;
    Ok(ImageDto { png_base64 })
}

#[tauri::command]
pub fn copy_card(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let image_dir = state.image_dir.clone();
    let db = lock(&state)?;
    let card = db.get(&id)?;
    match card.kind.as_str() {
        "text" => {
            let body = card.body;
            drop(db);
            app.clipboard()
                .write_text(body)
                .map_err(|err| format!("无法复制：{err}"))?;
        }
        "image" => {
            let name = card
                .image_file
                .ok_or_else(|| "图片文件不在了".to_string())?;
            let path = images::full_image_path(&image_dir, &name)?;
            let decoded = image::open(&path)
                .map_err(|_| "图片文件不在了".to_string())?
                .to_rgba8();
            let (width, height) = decoded.dimensions();
            let clipboard_image = tauri::image::Image::new_owned(decoded.into_raw(), width, height);
            drop(db);
            app.clipboard()
                .write_image(&clipboard_image)
                .map_err(|err| format!("无法复制图片：{err}"))?;
        }
        _ => return Err("这张卡片不能复制".into()),
    }
    Ok(())
}

fn run_on_ui_thread<T, F>(app: &AppHandle, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    eprintln!("[便利板] scheduling work on UI thread");
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        eprintln!("[便利板] UI thread work start");
        let result = work();
        let _ = tx.send(result);
    })
    .map_err(|err| format!("无法调度到主线程：{err}"))?;
    rx.recv_timeout(Duration::from_secs(12))
        .map_err(|_| {
            eprintln!("[便利板] UI thread work timed out");
            "创建截图层超时，窗口可能卡住了。".to_string()
        })?
}

/// WebView2 的控制器创建是异步的，完成回调要走 UI 消息循环。
/// 若在 `run_on_main_thread` 里同步等待 `WebviewWindowBuilder::build()`，
/// UI 线程被堵住，回调永远到不了，窗口会停在默认的隐藏 800×600 黑窗。
/// 所以 build 必须在后台线程发起并等待，让 UI 线程保持泵消息。
const OVERLAY_PREFIX: &str = "capture-overlay-";

pub fn schedule_overlay_precreate(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        eprintln!("[便利板] precreate start");
        let count = app
            .available_monitors()
            .map(|list| list.len().max(1))
            .unwrap_or(1);
        match ensure_overlay_windows(&app, count) {
            Ok(()) => eprintln!("[便利板] precreate done, overlays={count}"),
            Err(err) => eprintln!("[便利板] precreate failed: {err}"),
        }
    });
}

fn ensure_overlays_off_ui(app: &AppHandle, count: usize) -> Result<(), String> {
    let missing = (0..count).any(|index| {
        app.get_webview_window(&format!("{OVERLAY_PREFIX}{index}"))
            .is_none()
    });
    if !missing {
        eprintln!("[便利板] overlays already ready, count={count}");
        return Ok(());
    }
    let app2 = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        eprintln!("[便利板] ensure overlays on dedicated thread, count={count}");
        let result = ensure_overlay_windows(&app2, count);
        let _ = tx.send(result);
    });
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|_| {
            eprintln!("[便利板] ensure overlays timed out");
            "创建截图层超时，窗口可能卡住了。".to_string()
        })?
}

fn ensure_overlay_windows(app: &AppHandle, count: usize) -> Result<(), String> {
    for index in 0..count {
        let label = format!("{OVERLAY_PREFIX}{index}");
        if app.get_webview_window(&label).is_some() {
            eprintln!("[便利板] overlay {label} already exists");
            continue;
        }
        eprintln!("[便利板] building overlay {label}");
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("capture.html".into()))
            .title("截图")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .resizable(false)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|err| format!("无法打开截图层：{err}"))?;
        let _ = window.hide();
        let handle = app.clone();
        let closed_label = label.clone();
        window.on_window_event(move |event| {
            if !matches!(event, tauri::WindowEvent::Destroyed) {
                return;
            }
            let overlays_left = handle.webview_windows().keys().any(|existing| {
                existing.starts_with(OVERLAY_PREFIX) && existing != &closed_label
            });
            if overlays_left {
                return;
            }
            restore_main(&handle);
        });
        eprintln!("[便利板] overlay built {label}");
    }
    Ok(())
}

#[tauri::command]
pub fn begin_capture(app: AppHandle) -> Result<(), String> {
    eprintln!("[便利板] begin_capture enter");
    let count = app
        .available_monitors()
        .map(|list| list.len().max(1))
        .unwrap_or(1);
    ensure_overlays_off_ui(&app, count)?;
    let app2 = app.clone();
    run_on_ui_thread(&app, move || begin_capture_on_ui(&app2))
}

fn begin_capture_on_ui(app: &AppHandle) -> Result<(), String> {
    eprintln!("[便利板] begin_capture_on_ui");
    let state = app.state::<AppState>();
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    close_transient_capture_windows(app);
    let monitors = app
        .available_monitors()
        .map_err(|err| format!("找不到屏幕：{err}"))?;
    if monitors.is_empty() {
        return Err("找不到屏幕".into());
    }
    let primary = app.primary_monitor().ok().flatten();
    let primary_at = primary
        .as_ref()
        .map(|monitor| (monitor.position().x, monitor.position().y));
    // 先把遮罩摆出来并抢到前台，再藏看板。若先 hide，Windows 会丢掉前台权限，
    // 新建的透明遮罩常常不显示、也收不到键鼠，看板就被藏起来回不来。
    if let Ok(mut guard) = state.capture_monitors.lock() {
        guard.clear();
    }
    eprintln!("[便利板] begin_capture presenting overlays, monitors={}", monitors.len());
    match present_existing_overlays(&app, &monitors, primary_at, &state.capture_monitors) {
        Ok(_) => {
            // 遮罩页面可能在列表写完前就去取屏幕信息并自行 end_capture。
            // 若遮罩已经没了，绝不能再把看板藏起来。
            eprintln!("[便利板] overlays reported ok, capture_open={}", capture_open(&app));
            if !capture_open(&app) {
                restore_main(&app);
                return Err("截图层已关闭，请再试一次。".into());
            }
            if let Err(err) = main.hide() {
                hide_capture_windows(&app);
                restore_main(&app);
                return Err(format!("无法隐藏看板：{err}"));
            }
            if !capture_open(&app) {
                restore_main(&app);
                return Err("截图层已关闭，请再试一次。".into());
            }
            Ok(())
        }
        Err(err) => {
            hide_capture_windows(&app);
            if let Ok(mut guard) = state.capture_monitors.lock() {
                guard.clear();
            }
            eprintln!("[便利板] begin_capture failed: {err}");
            restore_main(&app);
            Err(err)
        }
    }
}

#[tauri::command]
pub fn capture_monitor(
    window: tauri::Window,
    state: State<'_, AppState>,
) -> Result<CaptureMonitor, String> {
    let label = window.label().to_string();
    let monitors = state
        .capture_monitors
        .lock()
        .map_err(|_| "截图状态忙".to_string())?;
    monitors
        .iter()
        .find(|item| item.label == label)
        .cloned()
        .ok_or_else(|| "找不到这块屏幕".to_string())
}

#[tauri::command]
pub fn capture_region(
    app: AppHandle,
    state: State<'_, AppState>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<Vec<CardDto>, String> {
    let app_hide = app.clone();
    run_on_ui_thread(&app, move || {
        hide_for_shot(&app_hide);
        Ok(())
    })?;
    wait_until_hidden_for_shot(&app);
    let image = capture::capture_rect(x, y, width, height)?;
    store_image(&state, &image, "截图")
}

#[tauri::command]
pub fn pin_card(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let card = {
        let db = lock(&state)?;
        db.get(&id)?
    };
    if card.kind != "image" {
        return Err("这不是图片".into());
    }
    let title = card
        .title
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "图片".to_string());
    let label = pin_label(&id);
    if let Some(existing) = app.get_webview_window(&label) {
        present_pin_window(&existing);
        return Ok(());
    }
    {
        let mut pending = state
            .pin_pending
            .lock()
            .map_err(|_| "钉出窗口正忙，请稍后再试。".to_string())?;
        if !pending.insert(label.clone()) {
            return Ok(());
        }
    }
    let app2 = app.clone();
    let label2 = label.clone();
    let title2 = title.clone();
    let id2 = id.clone();
    std::thread::spawn(move || {
        eprintln!("[便利板] building pin {label2} on dedicated thread");
        let result = build_pin_window(&app2, &label2, &title2, &id2);
        finish_pin_pending(&app2, &label2);
        match result {
            Ok(()) => {
                if let Some(existing) = app2.get_webview_window(&label2) {
                    present_pin_window(&existing);
                }
                eprintln!("[便利板] pin built {label2}");
            }
            Err(err) => {
                eprintln!("[便利板] pin failed {label2}: {err}");
                let _ = app2.emit("pin-failed", err);
            }
        }
    });
    Ok(())
}

fn present_pin_window(window: &tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    force_show_window(window, true);
}

fn finish_pin_pending(app: &AppHandle, label: &str) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut pending) = state.pin_pending.lock() {
            pending.remove(label);
        }
    }
}

#[tauri::command]
pub fn end_capture(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(mut monitors) = state.capture_monitors.lock() {
        monitors.clear();
    }
    let app2 = app.clone();
    run_on_ui_thread(&app, move || {
        hide_capture_windows(&app2);
        restore_main(&app2);
        Ok(())
    })
}

fn capture_open(app: &AppHandle) -> bool {
    app.webview_windows().iter().any(|(label, window)| {
        label.starts_with("capture-") && window.is_visible().unwrap_or(false)
    })
}

fn publish_monitors(
    stash: &std::sync::Mutex<Vec<CaptureMonitor>>,
    items: &[CaptureMonitor],
) {
    if let Ok(mut guard) = stash.lock() {
        *guard = items.to_vec();
    }
}

fn present_existing_overlays(
    app: &AppHandle,
    monitors: &[tauri::Monitor],
    primary_at: Option<(i32, i32)>,
    stash: &std::sync::Mutex<Vec<CaptureMonitor>>,
) -> Result<Vec<CaptureMonitor>, String> {
    let mut stored = Vec::new();
    let mut focus_label = None;
    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("{OVERLAY_PREFIX}{index}");
        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("找不到截图层 {label}"))?;
        let position = monitor.position();
        let size = monitor.size();
        let info = CaptureMonitor {
            label: label.clone(),
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            scale: monitor.scale_factor(),
        };
        stored.push(info);
        // 必须在页面脚本启动前写好，否则 captureMonitor 会失败并立刻关掉遮罩。
        publish_monitors(stash, &stored);
        eprintln!("[便利板] presenting overlay {label}");
        present_overlay(&window, *position, *size).map_err(|err| {
            eprintln!("[便利板] present_overlay failed: {err}");
            err
        })?;
        eprintln!("[便利板] overlay visible {label}");
        if primary_at == Some((position.x, position.y)) || focus_label.is_none() {
            focus_label = Some(label.clone());
        }
    }
    if let Some(label) = focus_label {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_focus();
        }
    }
    Ok(stored)
}

fn present_overlay(
    window: &tauri::WebviewWindow,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<(), String> {
    window
        .set_position(position)
        .map_err(|err| format!("无法摆放截图层：{err}"))?;
    window
        .set_size(size)
        .map_err(|err| format!("无法摆放截图层：{err}"))?;
    let _ = window.set_ignore_cursor_events(false);
    let _ = window.set_always_on_top(true);
    // 预创建的页面可能已经跑完 boot 并因当时没有屏幕信息而结束。
    // 刷新后再显示，让选区脚本在 monitors 已经发布之后重新启动。
    let _ = window.eval("location.reload()");
    window
        .show()
        .map_err(|err| format!("无法显示截图层：{err}"))?;
    // 隐藏状态下设置的位置/尺寸在 Windows 上有时不会生效，显示后再写一次。
    let _ = window.set_position(position);
    let _ = window.set_size(size);
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    // 遮罩不要用 SW_RESTORE，以免把刚设好的全屏尺寸改回去。
    force_show_window(window, false);
    if window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let _ = window.show();
    force_show_window(window, false);
    if window.is_visible().unwrap_or(false) {
        Ok(())
    } else {
        Err("无法显示截图层".into())
    }
}

fn restore_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_always_on_top(true);
        let _ = main.set_focus();
        force_show_window(&main, true);
    }
}

fn force_show_window(window: &tauri::WebviewWindow, activate: bool) {
    #[cfg(windows)]
    {
        force_show_window_win(window, activate);
    }
    #[cfg(not(windows))]
    {
        let _ = (window, activate);
    }
}

#[cfg(windows)]
fn set_outer_geometry_win(
    window: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let handle = hwnd.0 as *mut std::ffi::c_void;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    let ok = unsafe {
        SetWindowPos(
            handle,
            std::ptr::null_mut(),
            x,
            y,
            width,
            height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    if ok == 0 {
        Err("无法设置窗口位置和尺寸".into())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn force_show_window_win(window: &tauri::WebviewWindow, activate: bool) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let handle = hwnd.0 as *mut std::ffi::c_void;
    const SW_SHOW: i32 = 5;
    const SW_RESTORE: i32 = 9;
    const HWND_TOPMOST: isize = -1;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    unsafe {
        ShowWindow(handle, if activate { SW_RESTORE } else { SW_SHOW });
        SetWindowPos(
            handle,
            HWND_TOPMOST as *mut std::ffi::c_void,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        SetForegroundWindow(handle);
    }
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn ShowWindow(hwnd: *mut std::ffi::c_void, cmd: i32) -> i32;
    fn SetWindowPos(
        hwnd: *mut std::ffi::c_void,
        insert_after: *mut std::ffi::c_void,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
    fn SetForegroundWindow(hwnd: *mut std::ffi::c_void) -> i32;
}

fn hide_for_shot(app: &AppHandle) {
    // 先把选区的 100vmax 暗色投影去掉，再藏窗。只 hide 的话，
    // Windows 合成器还来得及把半透明遮罩打进 xcap 的截图里。
    clear_overlay_chrome(app);
    if let Some(main) = app.get_webview_window("main") {
        force_hide_window(&main);
    }
    for (label, window) in app.webview_windows() {
        if label.starts_with("capture-") || label.starts_with("pin-") {
            force_hide_window(&window);
        }
    }
}

fn clear_overlay_chrome(app: &AppHandle) {
    const SCRIPT: &str = r#"
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
      document.body.style.opacity = "0";
      const shade = document.getElementById("shade");
      if (shade) { shade.style.background = "transparent"; shade.hidden = true; }
      const rect = document.getElementById("rect");
      if (rect) {
        rect.style.boxShadow = "none";
        rect.style.border = "none";
        rect.style.background = "transparent";
      }
      const hint = document.getElementById("hint");
      if (hint) hint.style.display = "none";
    "#;
    for (label, window) in app.webview_windows() {
        if label.starts_with("capture-") {
            let _ = window.eval(SCRIPT);
        }
    }
}

fn force_hide_window(window: &tauri::WebviewWindow) {
    let _ = window.hide();
    #[cfg(windows)]
    force_hide_window_win(window);
}

#[cfg(windows)]
fn force_hide_window_win(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let handle = hwnd.0 as *mut std::ffi::c_void;
    const SW_HIDE: i32 = 0;
    unsafe {
        ShowWindow(handle, SW_HIDE);
    }
}

fn window_is_visible(window: &tauri::WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false)
}

fn anything_visible_for_shot(app: &AppHandle) -> bool {
    if let Some(main) = app.get_webview_window("main") {
        if window_is_visible(&main) {
            return true;
        }
    }
    app.webview_windows().iter().any(|(label, window)| {
        (label.starts_with("capture-") || label.starts_with("pin-")) && window_is_visible(window)
    })
}

fn wait_until_hidden_for_shot(app: &AppHandle) {
    for _ in 0..15 {
        if !anything_visible_for_shot(app) {
            break;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    // 再给 DWM / DXGI 一帧以上的时间，避免抓到刚藏起来的半透明层。
    std::thread::sleep(Duration::from_millis(280));
}

fn pin_label(id: &str) -> String {
    let safe: String = id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch
            } else {
                '-'
            }
        })
        .collect();
    format!("pin-{safe}")
}

fn js_string(value: &str) -> String {
    let mut out = String::new();
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn build_pin_window(app: &AppHandle, label: &str, title: &str, id: &str) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.show();
        force_show_window(&existing, true);
        return Ok(());
    }
    eprintln!("[便利板] building pin {label}");
    let script = format!(
        "window.__PIN_ID__ = {}; window.__PIN_TITLE__ = {};",
        js_string(id),
        js_string(title)
    );
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("pin.html".into()))
        .title(title)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(false)
        .shadow(false)
        .visible(false)
        .center()
        .inner_size(420.0, 360.0)
        .min_inner_size(220.0, 160.0)
        .initialization_script(&script)
        .build()
        .map_err(|err| format!("无法钉出图片：{err}"))?;
    let _ = window.show();
    force_show_window(&window, true);
    eprintln!("[便利板] pin built {label}");
    Ok(())
}

fn hide_capture_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("capture-") {
            let _ = window.hide();
        }
    }
}

fn close_transient_capture_windows(app: &AppHandle) {
    let labels = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("capture-") && !label.starts_with(OVERLAY_PREFIX))
        .cloned()
        .collect::<Vec<_>>();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
}

fn read_clipboard_image(app: &AppHandle) -> Result<Option<RgbaImage>, String> {
    let image = match app.clipboard().read_image() {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };
    let width = image.width();
    let height = image.height();
    if let Some(reason) = images::dimension_error(width, height) {
        return Err(format!("剪贴板图片{reason}。"));
    }
    let raw = image.rgba();
    let expected = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    if raw.len() != expected {
        return Err("剪贴板图片无法读取。".into());
    }
    RgbaImage::from_raw(width, height, raw.to_vec())
        .map(Some)
        .ok_or_else(|| "剪贴板图片无法读取。".to_string())
}

fn store_image(state: &AppState, image: &RgbaImage, prefix: &str) -> Result<Vec<CardDto>, String> {
    let image_dir = state.image_dir.clone();
    let saved = images::store_rgba(&image_dir, image)?;
    let mut db = lock(state)?;
    if let Err(err) = db.insert_images(&saved_as_new(std::slice::from_ref(&saved)), prefix) {
        drop(db);
        images::remove_files(&image_dir, &saved.image_file, &saved.thumb_file);
        return Err(err);
    }
    Ok(to_dtos(&image_dir, db.list_cards()?))
}

fn lock(state: &AppState) -> Result<MutexGuard<'_, crate::db::Db>, String> {
    state.db.lock().map_err(|_| "数据库忙".to_string())
}

fn saved_as_new(saved: &[SavedImage]) -> Vec<NewImage> {
    saved
        .iter()
        .map(|image| NewImage {
            id: image.id.clone(),
            image_file: image.image_file.clone(),
            thumb_file: image.thumb_file.clone(),
        })
        .collect()
}

fn to_dtos(dir: &std::path::Path, rows: Vec<CardRow>) -> Vec<CardDto> {
    rows.into_iter().map(|row| to_dto(dir, row)).collect()
}

fn to_dto(dir: &std::path::Path, row: CardRow) -> CardDto {
    let thumb_png_base64 = row
        .thumb_file
        .as_deref()
        .and_then(|name| images::read_base64(dir, name));
    CardDto {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        sort_order: row.sort_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
        thumb_png_base64,
    }
}
