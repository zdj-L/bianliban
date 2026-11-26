import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  beginCapture,
  cardImage,
  clipboardText,
  copyCard,
  createTextCard,
  deleteCard,
  endCapture,
  moveCardToTop,
  importImagePaths,
  loadBoard,
  nextName,
  pasteImage,
  pinCard,
  renameCard,
  updateTextCard,
} from "./api";
import { displayName, namePrefix } from "./cards";
import type { Card } from "./types";
import {
  askName,
  bindNameDialog,
  chipMenuOpen,
  fillEditor,
  focusEditor,
  isDragTarget,
  nameDialogOpen,
  readEditorBody,
  renderBoard,
  setBackLabel,
  setEditorDeleteLabel,
  setImageDeleteLabel,
  isImageZoomed,
  nudgeImageZoom,
  setImageHeading,
  setImageStage,
  setImageZoomed,
  setStatus,
  showPanel,
} from "./view";
import {
  closeChipMenu,
  collapseWindow,
  expandWindow,
  isCollapsed,
  openChipMenu,
  placeWindow,
  settleCollapsedChip,
  watchGeometry,
} from "./windowctl";

type View =
  | { kind: "board" }
  | { kind: "editor"; id: string | null; initialBody: string }
  | { kind: "image"; id: string };

const state: {
  cards: Card[];
  view: View;
  editorConfirm: boolean;
  imageConfirm: boolean;
  boardConfirmId: string | null;
  discardArmed: boolean;
  capturing: boolean;
  busy: boolean;
} = {
  cards: [],
  view: { kind: "board" },
  editorConfirm: false,
  imageConfirm: false,
  boardConfirmId: null,
  discardArmed: false,
  capturing: false,
  busy: false,
};

void boot();

async function boot(): Promise<void> {
  const win = getCurrentWindow();
  bindNameDialog();
  wire(win);
  let saved: Awaited<ReturnType<typeof loadBoard>>["window"] = null;
  try {
    const board = await loadBoard();
    state.cards = board.cards;
    saved = board.window;
    paintBoard();
  } catch (err) {
    setStatus(errorText(err));
  }
  try {
    await placeWindow(saved);
    watchGeometry();
  } catch (err) {
    setStatus(errorText(err));
  }
  await listen<{ message: string }>("capture-done", (event) => {
    state.capturing = false;
    void refreshAfterCapture(event.payload.message);
  });
  await win.show();
}

function wire(win: ReturnType<typeof getCurrentWindow>): void {
  document.querySelector("#shot")?.addEventListener("click", () => {
    void startShot();
  });
  document.querySelector("#collapse")?.addEventListener("click", () => {
    void collapseBoard();
  });
  document.querySelector("#image-collapse")?.addEventListener("click", () => {
    void collapseBoard();
  });
  document.querySelector("#quit")?.addEventListener("click", () => {
    void win.close();
  });
  wireChip(win);
  document.getElementById("grid")?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("#add-card")) {
      openNew();
      return;
    }
    const card = target.closest<HTMLElement>(".card");
    const id = card?.dataset.id;
    if (!id) return;
    const act = target.closest<HTMLElement>("[data-act]")?.dataset.act ?? "open";
    void onCardAction(id, act);
  });
  document.querySelector("#back")?.addEventListener("click", () => leaveEditor());
  document.querySelector("#save")?.addEventListener("click", () => {
    void saveEditor();
  });
  document.querySelector("#editor-rename")?.addEventListener("click", () => {
    if (state.view.kind === "editor" && state.view.id) void renameOpen(state.view.id);
  });
  document.querySelector("#editor-delete")?.addEventListener("click", () => {
    if (state.view.kind !== "editor" || !state.view.id) return;
    if (!state.editorConfirm) {
      state.editorConfirm = true;
      setEditorDeleteLabel(true);
      return;
    }
    void remove(state.view.id);
  });
  document.querySelector("#image-back")?.addEventListener("click", () => showBoard());
  document.querySelector("#image-rename")?.addEventListener("click", () => {
    if (state.view.kind === "image") void renameOpen(state.view.id);
  });
  document.querySelectorAll(".image-pin").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.view.kind === "image") void pinOpen(state.view.id);
    });
  });
  document.querySelector("#image-stage")?.addEventListener(
    "wheel",
    (event) => {
      if (!isImageZoomed()) return;
      if (!(event instanceof WheelEvent)) return;
      event.preventDefault();
      nudgeImageZoom(event.deltaY);
    },
    { passive: false },
  );
  document.querySelector("#image-stage")?.addEventListener("click", (event) => {
    if (state.view.kind !== "image") return;
    const target = event.target as Element | null;
    if (target?.closest("button")) return;
    const clickedImage = Boolean(target?.closest("img"));
    if (!clickedImage && !isImageZoomed()) return;
    setImageZoomed(!isImageZoomed());
  });
  document.querySelector("#image-copy")?.addEventListener("click", () => {
    if (state.view.kind === "image") void copyOne(state.view.id);
  });
  document.querySelector("#image-delete")?.addEventListener("click", () => {
    if (state.view.kind !== "image") return;
    if (!state.imageConfirm) {
      state.imageConfirm = true;
      setImageDeleteLabel(true);
      return;
    }
    void remove(state.view.id);
  });

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || nameDialogOpen() || isCollapsed()) return;
    if (!isDragTarget(event.target)) return;
    event.preventDefault();
    void win.startDragging();
  });

  document.querySelectorAll<HTMLElement>("#handles [data-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || isCollapsed()) return;
      const direction = resizeDirection(handle.dataset.resize);
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      void win.startResizeDragging(direction);
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("#editor-delete, #image-delete")) return;
    if (state.editorConfirm) {
      state.editorConfirm = false;
      setEditorDeleteLabel(false);
    }
    if (state.imageConfirm) {
      state.imageConfirm = false;
      setImageDeleteLabel(false);
    }
    if (state.discardArmed && !target?.closest("#back")) {
      state.discardArmed = false;
      setBackLabel(false);
    }
    if (chipMenuOpen() && !target?.closest("#chip-wrap")) {
      void closeChipMenu();
    }
  });

  document.addEventListener("paste", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("#editor-body")) {
      event.preventDefault();
      void pasteIntoEditor();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (chipMenuOpen() && event.key === "Escape") {
      event.preventDefault();
      void closeChipMenu();
      return;
    }
    if (state.capturing && event.key === "Escape") {
      event.preventDefault();
      void abortCapture("已取消截图。");
      return;
    }
    if (nameDialogOpen()) return;
    if (event.key === "Escape") {
      if (state.view.kind === "image" && isImageZoomed()) {
        event.preventDefault();
        setImageZoomed(false);
        return;
      }
      if (state.view.kind === "editor") leaveEditor();
      else if (state.view.kind === "image") showBoard();
      return;
    }
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "s" || event.key === "Enter")) {
      if (state.view.kind !== "editor") return;
      event.preventDefault();
      void saveEditor();
      return;
    }
    if (key === "v" && (event.ctrlKey || event.metaKey) && !event.altKey) {
      if (state.view.kind === "editor" || isField(document.activeElement)) return;
      event.preventDefault();
      void pasteOntoBoard();
    }
  });

  void win.onDragDropEvent((event) => {
    if (event.payload.type === "drop") void onDrop(event.payload.paths);
  });
}

function wireChip(win: ReturnType<typeof getCurrentWindow>): void {
  const chip = document.getElementById("chip");
  if (!chip) return;
  let origin: { x: number; y: number } | null = null;
  let dragged = false;

  chip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    origin = { x: event.screenX, y: event.screenY };
    dragged = false;
  });
  chip.addEventListener("pointermove", (event) => {
    if (!origin || event.buttons === 0) return;
    const dx = event.screenX - origin.x;
    const dy = event.screenY - origin.y;
    if (dragged || dx * dx + dy * dy < 16) return;
    dragged = true;
    void closeChipMenu().then(() => win.startDragging());
  });
  chip.addEventListener("pointerup", () => {
    origin = null;
    if (dragged) void settleCollapsedChip();
  });
  chip.addEventListener("click", (event) => {
    if (dragged) {
      event.preventDefault();
      event.stopPropagation();
      dragged = false;
      return;
    }
    if (chipMenuOpen()) {
      void closeChipMenu();
      return;
    }
    void expandWindow();
  });
  chip.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openChipMenu();
  });
}

function paintBoard(): void {
  state.boardConfirmId = null;
  renderBoard(state.cards);
}

function showBoard(): void {
  state.view = { kind: "board" };
  state.discardArmed = false;
  state.editorConfirm = false;
  state.imageConfirm = false;
  state.boardConfirmId = null;
  setImageZoomed(false);
  setBackLabel(false);
  showPanel("board");
}

function openNew(): void {
  paintBoard();
  state.view = { kind: "editor", id: null, initialBody: "" };
  state.discardArmed = false;
  state.editorConfirm = false;
  fillEditor("新笔记", "", false);
  showPanel("editor");
  focusEditor();
  setStatus("");
}

function leaveEditor(): void {
  if (state.view.kind !== "editor") {
    showBoard();
    return;
  }
  const dirty = readEditorBody() !== state.view.initialBody;
  if (dirty && !state.discardArmed) {
    state.discardArmed = true;
    setBackLabel(true);
    return;
  }
  showBoard();
}

async function onCardAction(id: string, act: string): Promise<void> {
  if (act === "top") {
    clearBoardDelete();
    await moveToTop(id);
    return;
  }
  if (act === "copy") {
    clearBoardDelete();
    await copyOne(id);
    return;
  }
  if (act === "delete") {
    if (state.boardConfirmId !== id) {
      armBoardDelete(id);
      return;
    }
    state.boardConfirmId = null;
    await remove(id);
    return;
  }
  if (act === "open") {
    clearBoardDelete();
    await openCard(id);
  }
}

function clearBoardDelete(): void {
  if (!state.boardConfirmId) return;
  state.boardConfirmId = null;
  document.querySelectorAll<HTMLButtonElement>('.card [data-act="delete"]').forEach((btn) => {
    btn.textContent = "删除";
    btn.classList.remove("danger");
  });
}

function armBoardDelete(id: string): void {
  state.boardConfirmId = id;
  document.querySelectorAll<HTMLButtonElement>('.card [data-act="delete"]').forEach((btn) => {
    const card = btn.closest(".card");
    const cardId = card instanceof HTMLElement ? card.dataset.id : undefined;
    const confirming = cardId === id;
    btn.textContent = confirming ? "确认删除" : "删除";
    btn.classList.toggle("danger", confirming);
  });
}

async function moveToTop(id: string): Promise<void> {
  try {
    state.cards = await moveCardToTop(id);
    paintBoard();
    setStatus("已置顶。");
  } catch (err) {
    setStatus(errorText(err));
  }
}

async function pinOpen(id: string): Promise<void> {
  try {
    await pinCard(id);
    setStatus("已把图片钉到桌面上。");
  } catch (err) {
    setStatus(errorText(err));
  }
}

void listen<string>("pin-failed", (event) => {
  setStatus(event.payload || "打不开钉出窗口。");
});

async function openCard(id: string): Promise<void> {
  const card = state.cards.find((item) => item.id === id);
  if (!card) return;
  if (card.kind === "text") {
    state.view = { kind: "editor", id, initialBody: card.body };
    state.discardArmed = false;
    state.editorConfirm = false;
    fillEditor(displayName(card.title), card.body, true);
    showPanel("editor");
    focusEditor();
    return;
  }
  state.view = { kind: "image", id };
  state.imageConfirm = false;
  setImageZoomed(false);
  setImageDeleteLabel(false);
  setImageHeading(displayName(card.title));
  setImageStage(note("正在读取图片…"));
  showPanel("image");
  try {
    const image = await cardImage(id);
    if (state.view.kind !== "image" || state.view.id !== id) return;
    const img = document.createElement("img");
    img.alt = displayName(card.title);
    img.draggable = false;
    img.src = `data:image/png;base64,${image.pngBase64}`;
    setImageStage(img);
  } catch (err) {
    setImageStage(note(errorText(err)));
  }
}

async function saveEditor(): Promise<void> {
  if (state.view.kind !== "editor" || state.busy || nameDialogOpen()) return;
  const body = readEditorBody();
  if (!body.trim()) {
    setStatus("先写点内容。");
    return;
  }
  const editing = state.view;
  state.busy = true;
  try {
    if (editing.id) {
      state.cards = await updateTextCard(editing.id, body);
      paintBoard();
      showBoard();
      setStatus("已保存。");
      return;
    }
    const suggestion = await nextName("文字").catch(() => "文字1");
    const chosen = await askName("给这条笔记起个名字", "", suggestion);
    if (chosen === null) return;
    state.cards = await createTextCard(chosen, body);
    paintBoard();
    showBoard();
    setStatus("已保存。");
  } catch (err) {
    setStatus(errorText(err));
  } finally {
    state.busy = false;
  }
}

async function renameOpen(id: string): Promise<void> {
  const card = state.cards.find((item) => item.id === id);
  if (!card || state.busy || nameDialogOpen()) return;
  const prefix = namePrefix(card.kind, card.title);
  const suggestion = await nextName(prefix, id).catch(() => `${prefix}1`);
  const chosen = await askName("改个名字", card.title?.trim() ?? "", suggestion);
  if (chosen === null) return;
  state.busy = true;
  try {
    state.cards = await renameCard(id, chosen);
    paintBoard();
    const name = displayName(state.cards.find((item) => item.id === id)?.title);
    if (state.view.kind === "editor" && state.view.id === id) {
      const heading = document.querySelector("#editor-title");
      if (heading) heading.textContent = name;
    }
    if (state.view.kind === "image" && state.view.id === id) setImageHeading(name);
    setStatus("已改名。");
  } catch (err) {
    setStatus(errorText(err));
  } finally {
    state.busy = false;
  }
}

async function copyOne(id: string): Promise<void> {
  const card = state.cards.find((item) => item.id === id);
  try {
    await copyCard(id);
    setStatus(card?.kind === "image" ? "已复制图片。" : "已复制正文。");
  } catch (err) {
    setStatus(errorText(err));
  }
}

async function remove(id: string): Promise<void> {
  try {
    state.cards = await deleteCard(id);
    state.editorConfirm = false;
    state.imageConfirm = false;
    paintBoard();
    showBoard();
    setStatus("已删除。");
  } catch (err) {
    setStatus(errorText(err));
  }
}

async function pasteOntoBoard(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  try {
    const result = await pasteImage();
    if (!result.added) {
      setStatus(result.message || "剪贴板里没有图片。");
      return;
    }
    state.cards = result.cards;
    paintBoard();
    showBoard();
    setStatus(result.message || "已添加图片。");
  } catch (err) {
    setStatus(errorText(err));
  } finally {
    state.busy = false;
  }
}

async function pasteIntoEditor(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  try {
    const result = await pasteImage();
    if (result.added) {
      state.cards = result.cards;
      paintBoard();
      const blank =
        state.view.kind === "editor" && state.view.id === null && readEditorBody().trim() === "";
      if (blank) showBoard();
      setStatus(result.message || "已添加图片。");
      return;
    }
    const text = await clipboardText();
    const area = document.querySelector<HTMLTextAreaElement>("#editor-body");
    if (!area || !text) {
      setStatus("剪贴板里没有可以贴的内容。");
      return;
    }
    insertAtCursor(area, text);
  } catch (err) {
    setStatus(errorText(err));
  } finally {
    state.busy = false;
  }
}

async function onDrop(paths: string[]): Promise<void> {
  if (state.busy || paths.length === 0) return;
  state.busy = true;
  try {
    const result = await importImagePaths(paths);
    state.cards = result.cards;
    paintBoard();
    const blank =
      state.view.kind === "editor" && state.view.id === null && readEditorBody().trim() === "";
    if (blank || state.view.kind !== "editor") showBoard();
    setStatus(describeImport(result.added, result.skipped));
  } catch (err) {
    setStatus(errorText(err));
  } finally {
    state.busy = false;
  }
}

async function collapseBoard(): Promise<void> {
  await abortCapture();
  await collapseWindow();
}

async function showMainWindow(): Promise<void> {
  const win = getCurrentWindow();
  try {
    await win.show();
    await win.unminimize();
    await win.setAlwaysOnTop(true);
    await win.setFocus();
  } catch {
    // Rust 的 restore 路径也会把窗口拉回来。
  }
}

let captureGen = 0;

async function abortCapture(reason = ""): Promise<void> {
  captureGen += 1;
  const wasCapturing = state.capturing;
  state.capturing = false;
  try {
    await endCapture();
  } catch {
    // 没有进行中的截图层。
  }
  await showMainWindow();
  if (reason) setStatus(reason);
  else if (wasCapturing) setStatus("");
}

async function startShot(): Promise<void> {
  if (isCollapsed()) {
    setStatus("请先展开看板再截图。");
    return;
  }
  if (state.capturing) {
    await abortCapture("上一次截图没有结束，已取消。请再点一次截图。");
    return;
  }
  const gen = (captureGen += 1);
  state.capturing = true;
  setStatus("正在准备截图…");
  console.log("[便利板] startShot gen=", gen);
  try {
    await beginCapture();
    console.log("[便利板] beginCapture returned gen=", gen, "capturing=", state.capturing);
    if (gen !== captureGen || !state.capturing) {
      try {
        await endCapture();
      } catch {
        /* already cancelled */
      }
      await showMainWindow();
    }
  } catch (err) {
    if (gen === captureGen) state.capturing = false;
    await showMainWindow();
    setStatus(errorText(err));
  }
}

async function refreshAfterCapture(message: string): Promise<void> {
  try {
    const board = await loadBoard();
    state.cards = board.cards;
    paintBoard();
  } catch (err) {
    setStatus(errorText(err));
    return;
  }
  if (isCollapsed()) await expandWindow();
  if (state.view.kind !== "board") showBoard();
  setStatus(message || "已取消截图。");
}

function describeImport(added: number, skipped: { name: string; reason: string }[]): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`已添加 ${added} 张图片`);
  if (skipped.length > 0) {
    const list = skipped.map((item) => `${item.name}（${item.reason}）`).join("、");
    parts.push(`已跳过 ${list}`);
  }
  if (parts.length === 0) return "";
  return `${parts.join("。")}。`;
}

function insertAtCursor(area: HTMLTextAreaElement, text: string): void {
  const start = area.selectionStart ?? area.value.length;
  const end = area.selectionEnd ?? start;
  area.setRangeText(text, start, end, "end");
  area.focus();
}

function note(text: string): HTMLParagraphElement {
  const node = document.createElement("p");
  node.className = "missing";
  node.textContent = text;
  return node;
}

function resizeDirection(value: string | undefined) {
  switch (value) {
    case "East":
    case "North":
    case "NorthEast":
    case "NorthWest":
    case "South":
    case "SouthEast":
    case "SouthWest":
    case "West":
      return value;
    default:
      return null;
  }
}

function isField(element: Element | null): boolean {
  if (!element) return false;
  const name = element.tagName;
  return name === "INPUT" || name === "TEXTAREA" || (element as HTMLElement).isContentEditable;
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "操作失败";
}
