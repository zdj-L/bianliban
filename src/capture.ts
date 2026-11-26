import { emit, listen } from "@tauri-apps/api/event";
import { cursorPosition } from "@tauri-apps/api/window";
import { captureMonitor, captureRegion, endCapture } from "./api";
import { normalizeSelection, selectionCssRect, selectionFromPointers, type Point } from "./geometry";
import type { CaptureMonitorInfo } from "./types";

interface DragPayload {
  start: Point;
  current: Point;
}

type Phase = "select" | "commit" | "done";

let phase: Phase = "select";

void boot();

async function waitForMonitor(): Promise<CaptureMonitorInfo> {
  let last = "找不到这块屏幕";
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await captureMonitor();
    } catch (err) {
      last = errorText(err);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw last;
}

async function boot(): Promise<void> {
  let monitor: CaptureMonitorInfo;
  try {
    monitor = await waitForMonitor();
  } catch (err) {
    await finish(errorText(err));
    return;
  }

  const rect = document.querySelector<HTMLElement>("#rect");
  const shade = document.querySelector<HTMLElement>("#shade");
  const root = document.documentElement;
  let dragging = false;
  let startPromise: Promise<Point> | null = null;
  let frame = 0;

  const drawPoints = (start: Point, current: Point) => {
    if (!rect || !shade) return;
    const selection = normalizeSelection(start, current);
    const box = selectionCssRect(selection, monitor);
    if (!box || selection.width < 1 || selection.height < 1) {
      rect.hidden = true;
      shade.hidden = false;
      return;
    }
    shade.hidden = true;
    rect.hidden = false;
    rect.style.left = `${box.left}px`;
    rect.style.top = `${box.top}px`;
    rect.style.width = `${box.width}px`;
    rect.style.height = `${box.height}px`;
  };

  await listen<DragPayload>("capture-drag", (event) => {
    if (phase !== "select") return;
    drawPoints(event.payload.start, event.payload.current);
  });

  document.querySelector("#cancel")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void finish("");
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    void finish("");
  });

  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void finish("");
  });

  root.addEventListener("pointerdown", (event) => {
    if (phase !== "select" || event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("button")) return;
    dragging = true;
    startPromise = cursorPosition();
    root.setPointerCapture?.(event.pointerId);
  });

  root.addEventListener("pointermove", () => {
    if (!dragging || !startPromise || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      void paint();
    });
  });

  root.addEventListener("pointerup", () => {
    if (!dragging || !startPromise) return;
    dragging = false;
    void commit(startPromise);
  });

  root.addEventListener("pointercancel", () => {
    dragging = false;
  });

  async function paint(): Promise<void> {
    if (!dragging || !startPromise || phase !== "select") return;
    const start = await startPromise;
    const current = await cursorPosition();
    drawPoints(start, current);
    await emit("capture-drag", { start, current } satisfies DragPayload);
  }

  async function commit(pending: Promise<Point>): Promise<void> {
    if (phase !== "select") return;
    const start = await pending;
    const end = await cursorPosition();
    const selection = selectionFromPointers(start, end);
    if (!selection || phase !== "select") return;
    phase = "commit";
    let message = "已添加截图。";
    try {
      await captureRegion(selection);
    } catch (err) {
      message = errorText(err);
    }
    phase = "select";
    await finish(message);
  }
}

async function finish(message: string): Promise<void> {
  if (phase !== "select") return;
  phase = "done";
  try {
    await emit("capture-done", { message });
  } catch {
    // 看板没在听也要把窗口收回来。
  }
  try {
    await endCapture();
  } catch {
    // 主窗口会在命令里被重新显示。
  }
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "截图失败";
}
