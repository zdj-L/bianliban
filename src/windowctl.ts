import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow, primaryMonitor, type Monitor } from "@tauri-apps/api/window";
import { saveWindow } from "./api";
import {
  CHIP_HEIGHT,
  CHIP_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  clampToWorkArea,
  collapseTarget,
  expandPlacement,
  motionFrames,
  placeChip,
  layoutFromSaved,
  resolveLayout,
  type ChipPlacement,
  type ScreenInfo,
  type WindowGeometry,
  type WindowLayout,
} from "./geometry";
import type { SavedWindow } from "./types";
import { chipMenuOpen, setChipDock, setChipMenu, setCollapsed } from "./view";

/** 胶囊下方展开「退出」菜单时的窗口高度，含阴影边距。 */
const CHIP_MENU_HEIGHT = 112;

let layout: WindowLayout = {
  board: { x: 80, y: 80, width: MIN_WIDTH, height: MIN_HEIGHT },
  chip: null,
  collapsed: false,
};
let applying = false;
let menuLift = 0;
/** 展开前的胶囊原位。靠边展开让位后，收起要回到这里，而不是平移后的看板左上角。 */
let homeChip: { x: number; y: number } | null = null;
/** 本次展开落定后的看板原点。用户若再拖动看板，则把新的左上角当作原位。 */
let expandAnchor: { x: number; y: number } | null = null;

export function isCollapsed(): boolean {
  return layout.collapsed;
}

export async function placeWindow(saved: SavedWindow | null): Promise<void> {
  const screens = await loadScreens();
  layout = resolveLayout(layoutFromSaved(saved), screens);
  await applyLayout();
}

export async function collapseWindow(): Promise<void> {
  if (layout.collapsed) return;
  const current = await readGeometry();
  if (current) layout.board = current;
  await applyLayout("collapse");
}

export async function expandWindow(): Promise<void> {
  if (!layout.collapsed) return;
  await closeChipMenu();
  const current = await readGeometry();
  if (current) layout.chip = { x: current.x, y: current.y };
  const screens = await loadScreens();
  const chip = layout.chip ?? { x: current?.x ?? layout.board.x, y: current?.y ?? layout.board.y };
  homeChip = { x: chip.x, y: chip.y };
  layout.board = expandPlacement(layout.board, chip, screens);
  layout.chip = chip;
  expandAnchor = { x: layout.board.x, y: layout.board.y };
  await applyLayout("expand");
}

/** 拖完胶囊后吸附贴边，并换成贴边外观。 */
export async function settleCollapsedChip(): Promise<void> {
  if (!layout.collapsed || applying) return;
  const current = await readGeometry();
  if (!current) return;
  const screens = await loadScreens();
  const placed = placeChip(current, screens, true);
  await applyChipFrame(placed);
  layout.chip = { x: placed.x, y: placed.y };
  homeChip = { x: placed.x, y: placed.y };
  await persistGeometry();
}

export async function openChipMenu(): Promise<void> {
  if (!layout.collapsed || chipMenuOpen()) return;
  const win = getCurrentWindow();
  const current = await readGeometry();
  const screens = await loadScreens();
  const scale = (await win.scaleFactor()) || 1;
  const origin = current ?? { x: layout.chip?.x ?? 0, y: layout.chip?.y ?? 0, width: CHIP_WIDTH, height: CHIP_HEIGHT };
  const docked = placeChip(origin, screens, false);
  const menuWidth = docked.width;
  const screen = screens.find((item) => pointOn(item, origin.x, origin.y)) ?? screens.find((item) => item.primary) ?? screens[0];
  let y = origin.y;
  menuLift = 0;
  if (screen) {
    const work = screen.work;
    const bottom = origin.y + CHIP_MENU_HEIGHT * scale;
    if (bottom > work.y + work.height) {
      const clamped = clampToWorkArea(
        { x: origin.x, y: origin.y, width: menuWidth, height: CHIP_MENU_HEIGHT },
        work,
        scale,
      );
      menuLift = origin.y - clamped.y;
      y = clamped.y;
    }
  }
  applying = true;
  try {
    setChipMenu(true);
    const scale = (await win.scaleFactor()) || 1;
    await win.setMinSize(new LogicalSize(menuWidth, CHIP_HEIGHT));
    await setOuterGeometry({ x: origin.x, y }, menuWidth, CHIP_MENU_HEIGHT, scale);
  } finally {
    applying = false;
  }
}

export async function closeChipMenu(): Promise<void> {
  if (!chipMenuOpen() && menuLift === 0) {
    setChipMenu(false);
    return;
  }
  const win = getCurrentWindow();
  const current = await readGeometry();
  const x = current?.x ?? layout.chip?.x ?? 0;
  const y = (current?.y ?? layout.chip?.y ?? 0) + menuLift;
  menuLift = 0;
  applying = true;
  try {
    setChipMenu(false);
    const docked = placeChip({ x, y }, await loadScreens(), false);
    const scale = (await win.scaleFactor()) || 1;
    await win.setMinSize(new LogicalSize(docked.width, docked.height));
    await setOuterGeometry(docked, docked.width, docked.height, scale);
    setChipDock(docked.dock);
    layout.chip = { x: docked.x, y: docked.y };
  } finally {
    applying = false;
  }
}

export function watchGeometry(): void {
  const win = getCurrentWindow();
  let timer = 0;
  const schedule = () => {
    if (applying) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void persistGeometry();
    }, 200);
  };
  void win.onMoved(schedule);
  void win.onResized(schedule);
}

async function applyLayout(motion?: "expand" | "collapse"): Promise<void> {
  if (motion === "expand") {
    await applyExpand();
    return;
  }
  if (motion === "collapse") {
    await applyCollapse();
    return;
  }
  const win = getCurrentWindow();
  applying = true;
  try {
    await win.setAlwaysOnTop(true);
    setCollapsed(layout.collapsed);
    if (layout.collapsed) {
      const chip = layout.chip ?? { x: layout.board.x, y: layout.board.y };
      const screens = await loadScreens();
      const placed = placeChip(chip, screens, false);
      try {
        await win.setResizable(false);
      } catch {
        /* 权限不足时仍靠隐藏拖拽边和最小尺寸限制 */
      }
      await applyChipFrame(placed);
      layout.chip = { x: placed.x, y: placed.y };
      homeChip = { x: placed.x, y: placed.y };
    } else {
      setChipDock(null);
      homeChip = layout.chip;
      expandAnchor = { x: layout.board.x, y: layout.board.y };
      try {
        await win.setResizable(true);
      } catch {
        /* ignore */
      }
      const scale = (await win.scaleFactor()) || 1;
      await win.setMinSize(new LogicalSize(MIN_WIDTH, MIN_HEIGHT));
      await setOuterGeometry(layout.board, layout.board.width, layout.board.height, scale);
    }
  } finally {
    applying = false;
  }
  await persistGeometry();
}

async function applyExpand(): Promise<void> {
  const win = getCurrentWindow();
  const current = await readGeometry();
  const from: WindowGeometry = current ?? {
    x: layout.chip?.x ?? layout.board.x,
    y: layout.chip?.y ?? layout.board.y,
    width: CHIP_WIDTH,
    height: CHIP_HEIGHT,
  };
  const target = { x: layout.board.x, y: layout.board.y, width: layout.board.width, height: layout.board.height };
  const home = { x: layout.chip?.x ?? from.x, y: layout.chip?.y ?? from.y };
  applying = true;
  try {
    await win.setAlwaysOnTop(true);
    await win.setMinSize(new LogicalSize(Math.min(from.width, CHIP_WIDTH), Math.min(from.height, CHIP_HEIGHT)));
    setChipDock(null);
    setCollapsed(false);
    layout.collapsed = false;
    try {
      await win.setResizable(true);
    } catch {
      /* ignore */
    }
    await animateGeometry(win, from, target);
    if (layout.board.width >= MIN_WIDTH && layout.board.height >= MIN_HEIGHT) {
      await win.setMinSize(new LogicalSize(MIN_WIDTH, MIN_HEIGHT));
    }
    layout.chip = home;
    homeChip = home;
    expandAnchor = { x: target.x, y: target.y };
  } finally {
    applying = false;
  }
  await persistGeometry({ skipSnap: true });
}

async function applyCollapse(): Promise<void> {
  const win = getCurrentWindow();
  const current = await readGeometry();
  const screens = await loadScreens();
  const from: WindowGeometry = current ?? layout.board;
  const home = homeChip ?? layout.chip ?? { x: from.x, y: from.y };
  const target = collapseTarget(from, home, screens);
  applying = true;
  try {
    await win.setAlwaysOnTop(true);
    try {
      await win.setResizable(false);
    } catch {
      /* ignore */
    }
    await win.setMinSize(new LogicalSize(Math.min(from.width, target.width), Math.min(from.height, target.height)));
    await animateGeometry(win, from, target);
    setCollapsed(true);
    setChipDock(target.dock);
    layout.collapsed = true;
    layout.chip = { x: target.x, y: target.y };
    homeChip = { x: target.x, y: target.y };
    expandAnchor = null;
    await applyChipFrame(target);
  } finally {
    applying = false;
  }
  await persistGeometry({ skipSnap: true });
}

async function applyChipFrame(placed: ChipPlacement): Promise<void> {
  const win = getCurrentWindow();
  setChipDock(placed.dock);
  setCollapsed(true);
  const scale = (await win.scaleFactor()) || 1;
  const current = await readGeometry();
  const already =
    current &&
    Math.abs(current.x - placed.x) <= 1 &&
    Math.abs(current.y - placed.y) <= 1 &&
    Math.abs(current.width - placed.width) <= 1 &&
    Math.abs(current.height - placed.height) <= 1;
  if (already) return;
  await win.setMinSize(new LogicalSize(placed.width, placed.height));
  await setOuterGeometry(placed, placed.width, placed.height, scale);
}

/** 一次设定外框位置和尺寸，避免先缩后移让窗口左右晃。 */
async function setOuterGeometry(
  origin: { x: number; y: number },
  width: number,
  height: number,
  scale: number,
): Promise<void> {
  await invoke("set_outer_geometry", {
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  });
}

async function setOuterPhysical(frame: { x: number; y: number; width: number; height: number }): Promise<void> {
  await invoke("set_outer_geometry", {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
  });
}

async function animateGeometry(
  win: ReturnType<typeof getCurrentWindow>,
  from: WindowGeometry,
  to: WindowGeometry,
): Promise<void> {
  const scale = (await win.scaleFactor()) || 1;
  const frames = motionFrames(from, to, scale, 10);
  const minW = Math.max(1, Math.min(from.width, to.width));
  const minH = Math.max(1, Math.min(from.height, to.height));
  await win.setMinSize(new LogicalSize(minW, minH));
  for (const frame of frames) {
    await setOuterPhysical(frame);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

async function persistGeometry(opts?: { skipSnap?: boolean }): Promise<void> {
  if (applying) return;
  const win = getCurrentWindow();
  try {
    if (!(await win.isVisible())) return;
  } catch {
    // 没有可见性权限时仍按尺寸写入。
  }
  const geometry = await readGeometry();
  if (!geometry) return;
  if (layout.collapsed) {
    if (chipMenuOpen() || menuLift !== 0) {
      layout.chip = { x: geometry.x, y: geometry.y + menuLift };
    } else if (opts?.skipSnap) {
      layout.chip = { x: geometry.x, y: geometry.y };
      homeChip = { x: geometry.x, y: geometry.y };
    } else {
      const screens = await loadScreens();
      const placed = placeChip(geometry, screens, true);
      const same =
        Math.abs(placed.x - geometry.x) <= 2 &&
        Math.abs(placed.y - geometry.y) <= 2 &&
        Math.abs(placed.width - geometry.width) <= 1 &&
        Math.abs(placed.height - geometry.height) <= 1;
      if (!same) {
        applying = true;
        try {
          await applyChipFrame(placed);
        } finally {
          applying = false;
        }
      } else {
        setChipDock(placed.dock);
      }
      layout.chip = { x: placed.x, y: placed.y };
      homeChip = { x: placed.x, y: placed.y };
    }
  } else {
    layout.board = geometry;
    if (
      expandAnchor &&
      (Math.abs(geometry.x - expandAnchor.x) > 2 || Math.abs(geometry.y - expandAnchor.y) > 2)
    ) {
      layout.chip = { x: geometry.x, y: geometry.y };
      homeChip = { x: geometry.x, y: geometry.y };
      expandAnchor = { x: geometry.x, y: geometry.y };
    }
  }
  await saveWindow(layout);
}

async function readGeometry(): Promise<WindowGeometry | null> {
  const win = getCurrentWindow();
  const [pos, size, scale] = await Promise.all([win.outerPosition(), win.innerSize(), win.scaleFactor()]);
  const factor = scale || 1;
  if (size.width < 2 || size.height < 2) return null;
  return {
    x: pos.x,
    y: pos.y,
    width: size.width / factor,
    height: size.height / factor,
  };
}

async function loadScreens(): Promise<ScreenInfo[]> {
  const [monitors, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
  const primaryId = primary ? monitorId(primary) : "";
  return monitors.map((monitor) => {
    const id = monitorId(monitor);
    return {
      bounds: {
        x: monitor.position.x,
        y: monitor.position.y,
        width: monitor.size.width,
        height: monitor.size.height,
      },
      work: {
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
      },
      scale: monitor.scaleFactor || 1,
      primary: id === primaryId,
    };
  });
}

function pointOn(screen: ScreenInfo, x: number, y: number): boolean {
  return (
    x >= screen.bounds.x &&
    x < screen.bounds.x + screen.bounds.width &&
    y >= screen.bounds.y &&
    y < screen.bounds.y + screen.bounds.height
  );
}

function monitorId(monitor: Monitor): string {
  return [monitor.position.x, monitor.position.y, monitor.size.width, monitor.size.height].join(":");
}
