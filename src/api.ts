import { invoke } from "@tauri-apps/api/core";
import type { WindowLayout } from "./geometry";
import type { BoardState, Card, CaptureMonitorInfo, ImagePayload, ImportOutcome, PasteOutcome } from "./types";

export function loadBoard(): Promise<BoardState> {
  return invoke<BoardState>("get_state");
}

export function createTextCard(title: string, body: string): Promise<Card[]> {
  return invoke<Card[]>("create_text_card", { title, body });
}

export function updateTextCard(id: string, body: string): Promise<Card[]> {
  return invoke<Card[]>("update_text_card", { id, body });
}

export function renameCard(id: string, title: string): Promise<Card[]> {
  return invoke<Card[]>("rename_card", { id, title });
}

export function deleteCard(id: string): Promise<Card[]> {
  return invoke<Card[]>("delete_card", { id });
}

export function moveCardToTop(id: string): Promise<Card[]> {
  return invoke<Card[]>("move_card_to_top", { id });
}

export function importImagePaths(paths: string[]): Promise<ImportOutcome> {
  return invoke<ImportOutcome>("import_image_paths", { paths });
}

export function pasteImage(): Promise<PasteOutcome> {
  return invoke<PasteOutcome>("paste_image");
}

export function clipboardText(): Promise<string> {
  return invoke<string>("clipboard_text");
}

export function copyCard(id: string): Promise<void> {
  return invoke("copy_card", { id });
}

export function saveWindow(layout: WindowLayout): Promise<void> {
  return invoke("save_window", {
    x: layout.board.x,
    y: layout.board.y,
    width: layout.board.width,
    height: layout.board.height,
    collapsed: layout.collapsed,
    chipX: layout.chip?.x ?? null,
    chipY: layout.chip?.y ?? null,
  });
}

export function nextName(prefix: string, exceptId?: string | null): Promise<string> {
  return invoke<string>("next_name", { prefix, exceptId: exceptId ?? null });
}

export function cardImage(id: string): Promise<ImagePayload> {
  return invoke<ImagePayload>("card_image", { id });
}

export function beginCapture(): Promise<void> {
  return invoke("begin_capture");
}

export function captureMonitor(): Promise<CaptureMonitorInfo> {
  return invoke<CaptureMonitorInfo>("capture_monitor");
}

export function captureRegion(rect: { x: number; y: number; width: number; height: number }): Promise<Card[]> {
  return invoke<Card[]>("capture_region", rect);
}

export function endCapture(): Promise<void> {
  return invoke("end_capture");
}

export function pinCard(id: string): Promise<void> {
  return invoke("pin_card", { id });
}
