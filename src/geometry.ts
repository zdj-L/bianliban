/**
 * 窗口位置和截图选区。纯函数，不依赖 Tauri。
 * 屏幕矩形用物理像素。窗口宽高用逻辑像素，位置用物理像素。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ScreenInfo {
  bounds: Rect;
  work: Rect;
  scale: number;
  primary: boolean;
}

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChipPosition {
  x: number;
  y: number;
}

export interface WindowLayout {
  board: WindowGeometry;
  chip: ChipPosition | null;
  collapsed: boolean;
}

export interface SavedWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed?: boolean;
  chipX?: number | null;
  chipY?: number | null;
}

export interface MonitorBox {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

/**
 * 展开后的默认大小，含窗口四周 10px 边距。
 * 网格为 minmax(120px, 1fr)、列距 10、左右 padding 12，再加 #app 10 和 1px 边框：
 * 两列至少约 296。336 时每列约 140，可稳定展示两列；高度 492 能放下标题、约两行卡片和状态栏。
 */
export const DEFAULT_WIDTH = 336;
export const DEFAULT_HEIGHT = 492;
/** 两列布局所需的最小逻辑宽度（不含用户再拖窄）。 */
export const TWO_COLUMN_MIN_WIDTH = 296;
export const MIN_WIDTH = 280;
export const MIN_HEIGHT = 360;
/** 上一版默认大小。恰好是这个尺寸的旧记录按新默认处理。 */
export const LEGACY_DEFAULT_WIDTH = 420;
export const LEGACY_DEFAULT_HEIGHT = 640;
/** 收起后的胶囊窗口，含阴影边距。可见胶囊大约 100×44。 */
export const CHIP_WIDTH = 120;
export const CHIP_HEIGHT = 64;
/** 左右贴边时的标签尺寸。窗口完全落在工作区内，靠内侧的一边保持圆角。 */
export const DOCK_SIDE_WIDTH = 84;
export const DOCK_SIDE_HEIGHT = 64;
/** 上下贴边时的标签尺寸。 */
export const DOCK_EDGE_WIDTH = 120;
export const DOCK_EDGE_HEIGHT = 48;
/** 靠近工作区边缘多少逻辑像素时吸附挂靠。须小于默认胶囊离边的边距。 */
export const CHIP_SNAP_DISTANCE = 20;

export type ChipDock = "left" | "right" | "top" | "bottom" | null;

export interface ChipPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  dock: ChipDock;
}
/** 小于这个物理像素的框选当作没选中。 */
export const MIN_SELECTION = 8;

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function positiveScale(scale: number, fallback = 1): number {
  if (!Number.isFinite(scale) || scale <= 0) return fallback;
  return scale;
}

function chooseLength(preferred: number, min: number, available: number): number {
  if (!Number.isFinite(available) || available <= 0) return preferred;
  const fitted = Math.min(preferred, Math.floor(available));
  if (fitted >= min) return fitted;
  return min;
}

export function isLegacyDefaultSize(width: number, height: number): boolean {
  return Math.round(width) === LEGACY_DEFAULT_WIDTH && Math.round(height) === LEGACY_DEFAULT_HEIGHT;
}

/** 没有记住的位置时，把默认看板放在工作区正中。工作区比默认尺寸小就缩小到放得下。 */
export function defaultPlacement(work: Rect, scale: number): WindowGeometry {
  const factor = positiveScale(scale);
  const availableW = work.width / factor;
  const availableH = work.height / factor;
  const width = chooseLength(DEFAULT_WIDTH, MIN_WIDTH, availableW);
  const height = chooseLength(DEFAULT_HEIGHT, MIN_HEIGHT, availableH);
  return {
    x: Math.round(work.x + ((availableW - width) / 2) * factor),
    y: Math.round(work.y + ((availableH - height) / 2) * factor),
    width,
    height,
  };
}

export function sanitizeSize(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) ? Math.round(width) : DEFAULT_WIDTH;
  const h = Number.isFinite(height) ? Math.round(height) : DEFAULT_HEIGHT;
  return {
    width: Math.min(10000, Math.max(MIN_WIDTH, w)),
    height: Math.min(10000, Math.max(MIN_HEIGHT, h)),
  };
}

function scaleNear(screens: ScreenInfo[], x: number, y: number): number {
  return pickScreen(screens, x, y).scale;
}

function pickScreen(screens: ScreenInfo[], x: number, y: number): ScreenInfo {
  const hit = screens.find((screen) => containsPoint(screen.bounds, { x, y }));
  const screen = hit ?? screens.find((item) => item.primary) ?? screens[0];
  return screen ?? { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, work: { x: 0, y: 0, width: 1920, height: 1040 }, scale: 1, primary: true };
}

function workNear(screens: ScreenInfo[], x: number, y: number): { work: Rect; scale: number } {
  const screen = pickScreen(screens, x, y);
  return { work: screen.work, scale: positiveScale(screen.scale) };
}

function physicalRect(geo: WindowGeometry, scale: number): Rect {
  const factor = positiveScale(scale);
  return { x: geo.x, y: geo.y, width: geo.width * factor, height: geo.height * factor };
}

/** 把窗口尽量完整地留在工作区内。窗口比工作区大时贴在工作区原点。 */
export function clampToWorkArea(geo: WindowGeometry, work: Rect, scale: number): WindowGeometry {
  const factor = positiveScale(scale);
  const physW = geo.width * factor;
  const physH = geo.height * factor;
  let x = geo.x;
  let y = geo.y;
  if (physW <= work.width) {
    x = Math.min(Math.max(x, work.x), work.x + work.width - physW);
  } else {
    x = work.x;
  }
  if (physH <= work.height) {
    y = Math.min(Math.max(y, work.y), work.y + work.height - physH);
  } else {
    y = work.y;
  }
  return { x: Math.round(x), y: Math.round(y), width: geo.width, height: geo.height };
}

export function defaultChipPlacement(work: Rect, scale: number): ChipPosition {
  const factor = positiveScale(scale);
  const margin = 28 * factor;
  const placed = clampToWorkArea(
    {
      x: work.x + work.width - CHIP_WIDTH * factor - margin,
      y: work.y + work.height - CHIP_HEIGHT * factor - margin,
      width: CHIP_WIDTH,
      height: CHIP_HEIGHT,
    },
    work,
    factor,
  );
  return { x: placed.x, y: placed.y };
}

function validChip(chip: ChipPosition | null | undefined, screens: ScreenInfo[]): ChipPosition | null {
  if (!chip || !Number.isFinite(chip.x) || !Number.isFinite(chip.y)) return null;
  const physical = physicalRect({ x: chip.x, y: chip.y, width: CHIP_WIDTH, height: CHIP_HEIGHT }, scaleNear(screens, chip.x, chip.y));
  if (!screens.some((screen) => intersects(physical, screen.bounds))) return null;
  const placed = placeChip(chip, screens, false);
  return { x: placed.x, y: placed.y };
}

export function chipSize(dock: ChipDock): { width: number; height: number } {
  if (dock === "left" || dock === "right") return { width: DOCK_SIDE_WIDTH, height: DOCK_SIDE_HEIGHT };
  if (dock === "top" || dock === "bottom") return { width: DOCK_EDGE_WIDTH, height: DOCK_EDGE_HEIGHT };
  return { width: CHIP_WIDTH, height: CHIP_HEIGHT };
}

/**
 * 把胶囊放到工作区内。snap 为真时，靠近或超出边缘就吸附成贴边标签；
 * 否则只在已经贴齐或伸出边缘时恢复贴边样式（启动时推断）。
 * 贴边后整个窗口都在工作区里，不会被屏幕边或任务栏裁掉。
 */
export function placeChip(
  chip: ChipPosition & { width?: number; height?: number },
  screens: ScreenInfo[],
  snap = false,
): ChipPlacement {
  const primary = screens.find((screen) => screen.primary) ?? screens[0];
  if (!Number.isFinite(chip.x) || !Number.isFinite(chip.y)) {
    if (!primary) return { x: 80, y: 80, width: CHIP_WIDTH, height: CHIP_HEIGHT, dock: null };
    const fallback = defaultChipPlacement(primary.work, primary.scale);
    return { ...fallback, width: CHIP_WIDTH, height: CHIP_HEIGHT, dock: null };
  }
  const { work, scale } = workNear(screens, chip.x, chip.y);
  const factor = positiveScale(scale);
  const measureW = (chip.width && chip.width > 0 ? chip.width : CHIP_WIDTH) * factor;
  const measureH = (chip.height && chip.height > 0 ? chip.height : CHIP_HEIGHT) * factor;
  const dock = snap
    ? pickDock(chip.x, chip.y, measureW, measureH, work, CHIP_SNAP_DISTANCE * factor)
    : pickDock(chip.x, chip.y, measureW, measureH, work, 6);
  const size = chipSize(dock);
  if (!dock) {
    const clamped = clampToWorkArea(
      { x: chip.x, y: chip.y, width: size.width, height: size.height },
      work,
      factor,
    );
    return { x: clamped.x, y: clamped.y, width: size.width, height: size.height, dock: null };
  }
  return flushDock(chip.x, chip.y, dock, work, factor);
}

function edgeGaps(x: number, y: number, physW: number, physH: number, work: Rect): Record<"left" | "right" | "top" | "bottom", number> {
  return {
    left: x - work.x,
    right: work.x + work.width - (x + physW),
    top: y - work.y,
    bottom: work.y + work.height - (y + physH),
  };
}

function pickDock(
  x: number,
  y: number,
  physW: number,
  physH: number,
  work: Rect,
  snapPx: number,
): ChipDock {
  const gaps = edgeGaps(x, y, physW, physH, work);
  const sides: Array<"left" | "right" | "top" | "bottom"> = ["left", "right", "top", "bottom"];
  const candidates = sides.filter((side) => gaps[side] <= snapPx);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const delta = gaps[a] - gaps[b];
    if (delta !== 0) return delta;
    const axis = (side: typeof a) => (side === "left" || side === "right" ? 0 : 1);
    return axis(a) - axis(b);
  });
  return candidates[0];
}

function flushDock(x: number, y: number, dock: Exclude<ChipDock, null>, work: Rect, scale: number): ChipPlacement {
  const size = chipSize(dock);
  const physW = size.width * scale;
  const physH = size.height * scale;
  let nextX = x;
  let nextY = y;
  if (dock === "right") nextX = work.x + work.width - physW;
  else if (dock === "left") nextX = work.x;
  else if (dock === "bottom") nextY = work.y + work.height - physH;
  else nextY = work.y;
  if (dock === "left" || dock === "right") {
    if (physH <= work.height) nextY = Math.min(Math.max(y, work.y), work.y + work.height - physH);
    else nextY = work.y;
  } else if (physW <= work.width) {
    nextX = Math.min(Math.max(x, work.x), work.x + work.width - physW);
  } else {
    nextX = work.x;
  }
  return { x: Math.round(nextX), y: Math.round(nextY), width: size.width, height: size.height, dock };
}

/** 小于这个物理像素的位移视为左上角没动（DPI 取整噪声），收起只改尺寸。 */
export const ORIGIN_TOLERANCE = 2;

export function originShifted(
  from: { x: number; y: number },
  to: { x: number; y: number },
  tolerance = ORIGIN_TOLERANCE,
): boolean {
  return Math.abs(from.x - to.x) > tolerance || Math.abs(from.y - to.y) > tolerance;
}

/**
 * 收起落点。空间足够（看板左上角仍是胶囊原位）时钉住当前左上角，只把宽高收到胶囊；
 * 仅当展开时发生了平移让位，才回到记住的挂靠/原位置。
 */
export function collapseTarget(
  board: WindowGeometry,
  savedChip: ChipPosition | null,
  screens: ScreenInfo[],
): ChipPlacement {
  const home =
    savedChip && Number.isFinite(savedChip.x) && Number.isFinite(savedChip.y)
      ? savedChip
      : { x: board.x, y: board.y };
  const remembered = collapsePlacement(board, home, screens);
  if (originShifted(board, home)) {
    return remembered;
  }
  const here = placeChip(
    { x: board.x, y: board.y, width: remembered.width, height: remembered.height },
    screens,
    false,
  );
  return {
    x: board.x,
    y: board.y,
    width: here.width,
    height: here.height,
    dock: here.dock,
  };
}

export interface PhysicalFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 把窗口从 from 收到/长到 to 的物理像素过渡帧。
 * 左上角几乎没动时锁定 x/y，只插值右缘和底边，避免 1px 来回晃。
 * 需要回原位时对左、上、右、下四边分别做物理像素插值，再反推宽高，
 * 保证各边单调靠近终点，不会因逻辑像素×DPI 取整让右缘左右抖。
 */
export function motionFrames(
  from: WindowGeometry,
  to: WindowGeometry,
  scale: number,
  steps = 10,
): PhysicalFrame[] {
  const factor = positiveScale(scale);
  const lock = !originShifted(from, to);
  const x0 = Math.round(from.x);
  const y0 = Math.round(from.y);
  const r0 = x0 + Math.max(1, Math.round(from.width * factor));
  const b0 = y0 + Math.max(1, Math.round(from.height * factor));
  const x1 = lock ? x0 : Math.round(to.x);
  const y1 = lock ? y0 : Math.round(to.y);
  const r1 = x1 + Math.max(1, Math.round(to.width * factor));
  const b1 = y1 + Math.max(1, Math.round(to.height * factor));
  const count = Math.max(1, Math.round(steps));
  const frames: PhysicalFrame[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i === count ? 1 : 1 - (1 - i / count) ** 2;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const r = Math.round(r0 + (r1 - r0) * t);
    const b = Math.round(b0 + (b1 - b0) * t);
    frames.push({
      x,
      y,
      width: Math.max(1, r - x),
      height: Math.max(1, b - y),
    });
  }
  return frames;
}

/**
 * 收起时的胶囊位置。优先回到展开前记住的原位（可贴边），否则用看板左上角。
 */
export function collapsePlacement(
  board: WindowGeometry,
  savedChip: ChipPosition | null,
  screens: ScreenInfo[],
): ChipPlacement {
  if (savedChip && Number.isFinite(savedChip.x) && Number.isFinite(savedChip.y)) {
    const physical = physicalRect(
      { x: savedChip.x, y: savedChip.y, width: CHIP_WIDTH, height: CHIP_HEIGHT },
      scaleNear(screens, savedChip.x, savedChip.y),
    );
    if (screens.some((screen) => intersects(physical, screen.bounds))) {
      return placeChip(savedChip, screens, true);
    }
  }
  return placeChip({ x: board.x, y: board.y }, screens, true);
}

/**
 * 交互收起：左上角钉在当前看板原点，只把宽高收到胶囊大小。不跳回旧的胶囊坐标。
 */
export function shrinkToChip(board: WindowGeometry, screens: ScreenInfo[]): WindowGeometry {
  const { work, scale } = workNear(screens, board.x, board.y);
  return clampToWorkArea(
    { x: board.x, y: board.y, width: CHIP_WIDTH, height: CHIP_HEIGHT },
    work,
    scale,
  );
}

/**
 * 展开用的目标尺寸：至少是默认两列大小，若用户曾把窗口拖得更大则沿用。
 * 只有整个工作区放不下时才缩小，且尽量不低于两列最小宽度。
 */
export function expandSize(
  savedBoard: WindowGeometry,
  work: Rect,
  scale: number,
): { width: number; height: number } {
  const saved = sanitizeSize(savedBoard.width, savedBoard.height);
  const preferred = {
    width: Math.max(saved.width, DEFAULT_WIDTH),
    height: Math.max(saved.height, DEFAULT_HEIGHT),
  };
  const factor = positiveScale(scale);
  const availW = work.width / factor;
  const availH = work.height / factor;
  return {
    width: fitToWork(preferred.width, TWO_COLUMN_MIN_WIDTH, MIN_WIDTH, availW),
    height: fitToWork(preferred.height, MIN_HEIGHT, MIN_HEIGHT, availH),
  };
}

function fitToWork(preferred: number, keep: number, min: number, available: number): number {
  if (!Number.isFinite(available) || available <= 0) return preferred;
  if (available >= preferred) return preferred;
  const fitted = Math.floor(available);
  if (fitted >= keep) return fitted;
  if (fitted >= min) return fitted;
  return min;
}

/**
 * 从胶囊展开看板。空间足够时左上角钉在胶囊，向右下长到默认两列（或更大的记住尺寸）。
 * 会顶出工作区时，只向左和/或向上平移刚好够用的距离，而不是把窗口钳得很小。
 */
export function expandPlacement(
  savedBoard: WindowGeometry,
  chip: ChipPosition,
  screens: ScreenInfo[],
): WindowGeometry {
  const { work, scale } = workNear(screens, chip.x, chip.y);
  const size = expandSize(savedBoard, work, scale);
  const factor = scale;
  const physW = size.width * factor;
  const physH = size.height * factor;
  let x = chip.x;
  let y = chip.y;
  if (x + physW > work.x + work.width) {
    x = work.x + work.width - physW;
  }
  if (y + physH > work.y + work.height) {
    y = work.y + work.height - physH;
  }
  if (x < work.x) x = work.x;
  if (y < work.y) y = work.y;
  return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height };
}

/**
 * 记住的窗口和任意一块屏幕有交集就放回原处，否则回到主屏工作区中央。
 * 完全落到屏幕外面的旧位置不用。恰好是上一版默认 420×640 的尺寸改用新默认。
 */
export function resolvePlacement(saved: WindowGeometry | null, screens: ScreenInfo[]): WindowGeometry {
  const primary = screens.find((screen) => screen.primary) ?? screens[0];
  if (!primary) {
    return { x: 80, y: 80, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
  const fallback = defaultPlacement(primary.work, primary.scale);
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return fallback;
  const size = isLegacyDefaultSize(saved.width, saved.height)
    ? sanitizeSize(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    : sanitizeSize(saved.width, saved.height);
  const scale = scaleNear(screens, saved.x, saved.y);
  const physical: Rect = {
    x: saved.x,
    y: saved.y,
    width: size.width * scale,
    height: size.height * scale,
  };
  if (!screens.some((screen) => intersects(physical, screen.bounds))) return fallback;
  if (isLegacyDefaultSize(saved.width, saved.height)) {
    const oldCenter = legacyCentered(primary.work, primary.scale);
    if (Math.round(saved.x) === oldCenter.x && Math.round(saved.y) === oldCenter.y) {
      return fallback;
    }
  }
  return { x: Math.round(saved.x), y: Math.round(saved.y), width: size.width, height: size.height };
}

function legacyCentered(work: Rect, scale: number): { x: number; y: number } {
  const factor = positiveScale(scale);
  const availableW = work.width / factor;
  const availableH = work.height / factor;
  const width = chooseLength(LEGACY_DEFAULT_WIDTH, MIN_WIDTH, availableW);
  const height = chooseLength(LEGACY_DEFAULT_HEIGHT, MIN_HEIGHT, availableH);
  return {
    x: Math.round(work.x + ((availableW - width) / 2) * factor),
    y: Math.round(work.y + ((availableH - height) / 2) * factor),
  };
}

export function layoutFromSaved(saved: SavedWindow | null): WindowLayout | null {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  const chip =
    Number.isFinite(saved.chipX) && Number.isFinite(saved.chipY)
      ? { x: saved.chipX as number, y: saved.chipY as number }
      : null;
  return {
    board: { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
    chip,
    collapsed: Boolean(saved.collapsed),
  };
}

/** 启动时决定当前窗口该是看板还是胶囊，并把两者都钳进工作区。 */
export function resolveLayout(saved: WindowLayout | null, screens: ScreenInfo[]): WindowLayout {
  const board = resolvePlacement(saved?.board ?? null, screens);
  const { work, scale } = workNear(screens, board.x, board.y);
  const clampedBoard = clampToWorkArea(board, work, scale);
  const chip = validChip(saved?.chip ?? null, screens);
  if (saved?.collapsed) {
    const current = collapsePlacement(clampedBoard, chip, screens);
    return { board: clampedBoard, chip: { x: current.x, y: current.y }, collapsed: true };
  }
  return { board: clampedBoard, chip, collapsed: false };
}

export function normalizeSelection(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** 物理像素选区。太小或坐标无效时返回 null，调用方保持截图状态、不入库。 */
export function selectionFromPointers(start: Point, end: Point, min = MIN_SELECTION): Rect | null {
  if (![start.x, start.y, end.x, end.y].every((value) => Number.isFinite(value))) return null;
  const rect = normalizeSelection(start, end);
  if (rect.width < min || rect.height < min) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** 把物理像素选区换成某块屏幕遮罩上的 CSS 像素，用来画选框。 */
export function selectionCssRect(
  selection: Rect,
  monitor: MonitorBox,
): { left: number; top: number; width: number; height: number } | null {
  const hit = intersection(selection, {
    x: monitor.x,
    y: monitor.y,
    width: monitor.width,
    height: monitor.height,
  });
  if (!hit) return null;
  const scale = positiveScale(monitor.scale);
  return {
    left: (hit.x - monitor.x) / scale,
    top: (hit.y - monitor.y) / scale,
    width: hit.width / scale,
    height: hit.height / scale,
  };
}
