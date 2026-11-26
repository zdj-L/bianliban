mod capture;
mod commands;
mod db;
mod images;
mod names;
mod paths;

use std::collections::HashSet;
use std::sync::Mutex;

use tauri::Manager;

pub struct AppState {
    pub db: Mutex<db::Db>,
    pub image_dir: std::path::PathBuf,
    pub capture_monitors: Mutex<Vec<capture::CaptureMonitor>>,
    pub pin_pending: Mutex<HashSet<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let root = paths::data_dir().map_err(std::io::Error::other)?;
            let image_dir = root.join("images");
            std::fs::create_dir_all(&image_dir)?;
            let database = db::Db::open(&root.join("cards.db")).map_err(std::io::Error::other)?;
            app.manage(AppState {
                db: Mutex::new(database),
                image_dir,
                capture_monitors: Mutex::new(Vec::new()),
                pin_pending: Mutex::new(HashSet::new()),
            });
            commands::schedule_overlay_precreate(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::next_name,
            commands::create_text_card,
            commands::update_text_card,
            commands::rename_card,
            commands::delete_card,
            commands::move_card_to_top,
            commands::import_image_paths,
            commands::paste_image,
            commands::clipboard_text,
            commands::card_image,
            commands::copy_card,
            commands::save_window,
            commands::set_outer_geometry,
            commands::begin_capture,
            commands::capture_monitor,
            commands::capture_region,
            commands::end_capture,
            commands::pin_card,
        ])
        .run(tauri::generate_context!())
        .expect("便利板启动失败");
}
