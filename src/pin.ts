import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { cardImage } from "./api";

declare global {
  interface Window {
    __PIN_ID__?: string;
    __PIN_TITLE__?: string;
  }
}

const CHROME_X = 52;
const CHROME_Y = 88;
const MIN_IMAGE = 120;
const ZOOM_STEP = 1.12;

void boot();

async function boot(): Promise<void> {
  const win = getCurrentWindow();
  const params = new URLSearchParams(window.location.search);
  const id = window.__PIN_ID__ || params.get("id") || "";
  const title = window.__PIN_TITLE__ || "图片";
  const heading = document.querySelector("#pin-title");
  if (heading) heading.textContent = title;
  document.title = title;

  document.querySelector("#pin-close")?.addEventListener("click", (event) => {
    event.stopPropagation();
    void win.close();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") void win.close();
  });

  const img = document.querySelector<HTMLImageElement>("#pin-image");
  const stage = document.getElementById("pin-stage");
  if (!img || !id) return;
  img.alt = title;
  try {
    const image = await cardImage(id);
    img.addEventListener(
      "load",
      () => {
        void bindPinImage(win, img, stage);
      },
      { once: true },
    );
    img.src = `data:image/png;base64,${image.pngBase64}`;
  } catch (err) {
    if (stage) stage.textContent = err instanceof Error ? err.message : "图片读不出来。";
  }
}

async function bindPinImage(
  win: ReturnType<typeof getCurrentWindow>,
  img: HTMLImageElement,
  stage: HTMLElement | null,
): Promise<void> {
  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const first = await sizeLimits();
  let imageWidth = preferredImageWidth(img, first);
  let applying = false;
  let pending = false;

  const apply = async (): Promise<void> => {
    const limits = await sizeLimits();
    const fitted = fitSize(aspect, imageWidth, limits);
    imageWidth = Math.max(1, fitted.width - CHROME_X);
    const [position, size] = await Promise.all([win.outerPosition(), win.innerSize()]);
    const factor = limits.scale;
    const curW = size.width / factor;
    const curH = size.height / factor;
    const curX = position.x / factor;
    const curY = position.y / factor;
    const nextX = clamp(
      curX + curW / 2 - fitted.width / 2,
      limits.workX,
      limits.workX + Math.max(0, limits.workW - fitted.width),
    );
    const nextY = clamp(
      curY + curH / 2 - fitted.height / 2,
      limits.workY,
      limits.workY + Math.max(0, limits.workH - fitted.height),
    );
    await win.setSize(new LogicalSize(fitted.width, fitted.height));
    await win.setPosition(new PhysicalPosition(Math.round(nextX * factor), Math.round(nextY * factor)));
  };

  const requestApply = (): void => {
    if (applying) {
      pending = true;
      return;
    }
    applying = true;
    void apply().finally(() => {
      applying = false;
      if (pending) {
        pending = false;
        requestApply();
      }
    });
  };

  requestApply();

  const host = stage ?? img;
  host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("#pin-close")) return;
    event.preventDefault();
    void win.startDragging();
  });
  host.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      const factor = event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      imageWidth = Math.max(MIN_IMAGE, imageWidth * factor);
      requestApply();
    },
    { passive: false },
  );
}

function preferredImageWidth(
  img: HTMLImageElement,
  limits: { maxW: number; maxH: number },
): number {
  const scale = window.devicePixelRatio || 1;
  const logicalW = img.naturalWidth / scale;
  const logicalH = img.naturalHeight / scale;
  const fit = Math.min(1, (limits.maxW - CHROME_X) / logicalW, (limits.maxH - CHROME_Y) / logicalH);
  return logicalW * fit;
}

function fitSize(
  aspect: number,
  imageWidth: number,
  limits: { maxW: number; maxH: number },
): { width: number; height: number } {
  let imgW = imageWidth;
  let imgH = imgW / aspect;
  const minW = MIN_IMAGE;
  const minH = MIN_IMAGE / aspect;
  if (imgW < minW || imgH < minH) {
    const grow = Math.max(minW / imgW, minH / imgH);
    imgW *= grow;
    imgH *= grow;
  }
  const maxImgW = Math.max(minW, limits.maxW - CHROME_X);
  const maxImgH = Math.max(MIN_IMAGE / aspect, limits.maxH - CHROME_Y);
  if (imgW > maxImgW || imgH > maxImgH) {
    const shrink = Math.min(maxImgW / imgW, maxImgH / imgH);
    imgW *= shrink;
    imgH *= shrink;
  }
  return {
    width: Math.max(220, Math.round(imgW + CHROME_X)),
    height: Math.max(160, Math.round(imgH + CHROME_Y)),
  };
}

async function sizeLimits(): Promise<{
  maxW: number;
  maxH: number;
  scale: number;
  workW: number;
  workH: number;
  workX: number;
  workY: number;
}> {
  const monitor = await currentMonitor();
  const scale = monitor?.scaleFactor ?? window.devicePixelRatio ?? 1;
  const work = monitor?.workArea;
  const workW = work ? work.size.width / scale : window.screen.availWidth;
  const workH = work ? work.size.height / scale : window.screen.availHeight;
  const workX = work ? work.position.x / scale : 0;
  const workY = work ? work.position.y / scale : 0;
  return {
    maxW: Math.max(280, workW - 24),
    maxH: Math.max(200, workH - 24),
    scale,
    workW,
    workH,
    workX,
    workY,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
