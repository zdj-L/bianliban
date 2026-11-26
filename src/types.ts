import type { SavedWindow, WindowGeometry } from "./geometry";

export type { SavedWindow, WindowGeometry };

export interface Card {
  id: string;
  kind: "text" | "image";
  title: string | null;
  body: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  thumbPngBase64: string | null;
}

export interface BoardState {
  window: SavedWindow | null;
  cards: Card[];
}

export interface SkippedFile {
  name: string;
  reason: string;
}

export interface ImportOutcome {
  cards: Card[];
  skipped: SkippedFile[];
  added: number;
}

export interface PasteOutcome {
  added: boolean;
  cards: Card[];
  message: string;
}

export interface ImagePayload {
  pngBase64: string;
}

export interface CaptureMonitorInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}
