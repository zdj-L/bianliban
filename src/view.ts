import { displayName, orderedCards, previewText } from "./cards";
import type { Card } from "./types";

export type Panel = "board" | "editor" | "image";

export type ChipDock = "left" | "right" | "top" | "bottom" | null;

const INTERACTIVE = "button, a, input, textarea, label, img, .card, .add-card, #handles, #name-dialog, #chip-wrap, #chip-menu";

export function isDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(INTERACTIVE)) return false;
  if (target.closest("#image-view.zoomed")) return false;
  return Boolean(target.closest("#titlebar, #board-view, #editor-bar, #image-bar, #image-stage"));
}

export function showPanel(panel: Panel): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (app) app.dataset.view = panel;
  const ids: Record<Panel, string> = {
    board: "board-view",
    editor: "editor-view",
    image: "image-view",
  };
  (Object.keys(ids) as Panel[]).forEach((name) => {
    const el = document.getElementById(ids[name]);
    if (el) el.hidden = name !== panel;
  });
  if (panel !== "image") setImageZoomed(false);
}

export function setCollapsed(collapsed: boolean): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (app) app.dataset.collapsed = collapsed ? "true" : "false";
  const chip = document.getElementById("chip");
  if (chip) chip.hidden = !collapsed;
  const wrap = document.getElementById("chip-wrap");
  if (wrap) wrap.hidden = !collapsed;
  const handles = document.getElementById("handles");
  if (handles) handles.hidden = collapsed;
  const surface = document.getElementById("surface");
  if (surface) surface.hidden = collapsed;
  if (!collapsed) {
    setChipMenu(false);
    setChipDock(null);
  }
}

export function setChipDock(dock: ChipDock): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  if (dock) app.dataset.dock = dock;
  else delete app.dataset.dock;
}

export function setChipMenu(open: boolean): void {
  const menu = document.getElementById("chip-menu");
  if (menu) menu.hidden = !open;
  const wrap = document.getElementById("chip-wrap");
  if (wrap) wrap.dataset.menu = open ? "open" : "closed";
}

export function chipMenuOpen(): boolean {
  return document.getElementById("chip-menu")?.hidden === false;
}

export function setStatus(text: string): void {
  const status = document.querySelector("#status");
  if (status) status.textContent = text;
}

export function renderBoard(cards: Card[]): void {
  const grid = document.getElementById("grid");
  if (!grid) return;
  const add = `<button type="button" class="add-card" id="add-card"><span class="plus" aria-hidden="true">+</span><span>新笔记</span></button>`;
  const items = orderedCards(cards)
    .map((card) => renderCardHtml(card))
    .join("");
  grid.innerHTML = add + items;
}

export function renderCardHtml(card: Card): string {
  const name = esc(displayName(card.title));
  const body =
    card.kind === "image"
      ? card.thumbPngBase64
        ? `<div class="thumb"><img alt="" draggable="false" src="data:image/png;base64,${card.thumbPngBase64}" /></div>`
        : `<p class="missing">缩略图读不出来。</p>`
      : `<p class="preview">${esc(previewText(card.body))}</p>`;
  return `<article class="card" data-id="${esc(card.id)}" data-kind="${card.kind}">
    <button type="button" class="open" data-act="open">
      <span class="name">${name}</span>
      ${body}
    </button>
    <div class="card-foot">
      <button type="button" class="ghost" data-act="top">置顶</button>
      <button type="button" class="ghost" data-act="copy">复制</button>
      <button type="button" class="ghost" data-act="delete">删除</button>
    </div>
  </article>`;
}

export function fillEditor(title: string, body: string, existing: boolean): void {
  const heading = document.querySelector("#editor-title");
  if (heading) heading.textContent = title;
  const area = document.querySelector<HTMLTextAreaElement>("#editor-body");
  if (area) area.value = body;
  const rename = document.querySelector<HTMLButtonElement>("#editor-rename");
  if (rename) rename.hidden = !existing;
  const remove = document.querySelector<HTMLButtonElement>("#editor-delete");
  if (remove) {
    remove.hidden = !existing;
    remove.textContent = "删除";
    remove.classList.remove("danger");
  }
  document.querySelector("#editor-view .page-actions")?.classList.toggle("empty", !existing);
  const back = document.querySelector<HTMLButtonElement>("#back");
  if (back) back.textContent = "返回";
}

export function readEditorBody(): string {
  return document.querySelector<HTMLTextAreaElement>("#editor-body")?.value ?? "";
}

export function setBackLabel(discarding: boolean): void {
  const back = document.querySelector<HTMLButtonElement>("#back");
  if (back) back.textContent = discarding ? "不保存并返回" : "返回";
}

export function focusEditor(): void {
  document.querySelector<HTMLTextAreaElement>("#editor-body")?.focus();
}

export function setImageHeading(title: string): void {
  const heading = document.querySelector("#image-title");
  if (heading) heading.textContent = title;
}

export function setImageStage(node: Node): void {
  const stage = document.getElementById("image-stage");
  if (!stage) return;
  stage.replaceChildren(node);
  resetImageZoomTransform();
}

export function setImageZoomed(zoomed: boolean): void {
  const view = document.getElementById("image-view");
  if (view) view.classList.toggle("zoomed", zoomed);
  const actions = document.getElementById("image-zoom-actions");
  if (actions) actions.hidden = !zoomed;
  if (!zoomed) resetImageZoomTransform();
}

export function isImageZoomed(): boolean {
  return document.getElementById("image-view")?.classList.contains("zoomed") ?? false;
}

const IMAGE_ZOOM_STEP = 1.12;
let imageZoomScale = 1;

export function nudgeImageZoom(deltaY: number): void {
  if (!isImageZoomed() || deltaY === 0) return;
  const img = document.querySelector<HTMLImageElement>("#image-stage img");
  if (!img) return;
  if (imageZoomScale === 1 && !img.dataset.zoomW) {
    const rect = img.getBoundingClientRect();
    img.dataset.zoomW = String(rect.width);
    img.dataset.zoomH = String(rect.height);
  }
  imageZoomScale *= deltaY > 0 ? 1 / IMAGE_ZOOM_STEP : IMAGE_ZOOM_STEP;
  imageZoomScale = Math.min(8, Math.max(0.4, imageZoomScale));
  applyImageZoomTransform(img);
}

function resetImageZoomTransform(): void {
  imageZoomScale = 1;
  const img = document.querySelector<HTMLImageElement>("#image-stage img");
  if (!img) return;
  delete img.dataset.zoomW;
  delete img.dataset.zoomH;
  img.style.width = "";
  img.style.height = "";
  img.style.maxWidth = "";
  img.style.maxHeight = "";
  img.classList.remove("zoomed-scaled");
}

function applyImageZoomTransform(img: HTMLImageElement): void {
  const baseW = Number(img.dataset.zoomW);
  const baseH = Number(img.dataset.zoomH);
  if (!(baseW > 0) || !(baseH > 0) || imageZoomScale === 1) {
    img.style.width = "";
    img.style.height = "";
    img.style.maxWidth = "";
    img.style.maxHeight = "";
    img.classList.remove("zoomed-scaled");
    return;
  }
  img.classList.add("zoomed-scaled");
  img.style.width = `${baseW * imageZoomScale}px`;
  img.style.height = `${baseH * imageZoomScale}px`;
  img.style.maxWidth = "none";
  img.style.maxHeight = "none";
}

export function setImageDeleteLabel(confirming: boolean): void {
  const button = document.querySelector<HTMLButtonElement>("#image-delete");
  if (!button) return;
  button.textContent = confirming ? "确认删除" : "删除";
  button.classList.toggle("danger", confirming);
}

export function setEditorDeleteLabel(confirming: boolean): void {
  const button = document.querySelector<HTMLButtonElement>("#editor-delete");
  if (!button) return;
  button.textContent = confirming ? "确认删除" : "删除";
  button.classList.toggle("danger", confirming);
}

let nameResolver: ((value: string | null) => void) | null = null;

export function bindNameDialog(): void {
  document.querySelector<HTMLFormElement>("#name-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = document.querySelector<HTMLInputElement>("#name-input")?.value ?? "";
    finishName(value.trim());
  });
  document.querySelector("#name-cancel")?.addEventListener("click", () => finishName(null));
  document.querySelector<HTMLInputElement>("#name-input")?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finishName(null);
  });
}

export function nameDialogOpen(): boolean {
  return document.getElementById("name-dialog")?.hidden === false;
}

export function askName(heading: string, initial: string, suggestion: string): Promise<string | null> {
  const dialog = document.getElementById("name-dialog");
  const title = document.querySelector("#name-heading");
  const input = document.querySelector<HTMLInputElement>("#name-input");
  const hint = document.querySelector("#name-hint");
  if (!dialog || !input) return Promise.resolve(null);
  if (title) title.textContent = heading;
  input.value = initial;
  input.placeholder = suggestion;
  if (hint) hint.textContent = `留空就叫${suggestion}`;
  dialog.hidden = false;
  input.focus();
  input.select();
  return new Promise((resolve) => {
    nameResolver = resolve;
  });
}

function finishName(value: string | null): void {
  const dialog = document.getElementById("name-dialog");
  if (dialog) dialog.hidden = true;
  const resolve = nameResolver;
  nameResolver = null;
  resolve?.(value);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
