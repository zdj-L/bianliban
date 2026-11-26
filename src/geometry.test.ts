import { describe, expect, it } from "vitest";
import {
  CHIP_HEIGHT,
  CHIP_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  clampToWorkArea,
  CHIP_SNAP_DISTANCE,
  DOCK_SIDE_WIDTH,
  DOCK_SIDE_HEIGHT,
  DOCK_EDGE_WIDTH,
  DOCK_EDGE_HEIGHT,
  collapsePlacement,
  collapseTarget,
  defaultChipPlacement,
  defaultPlacement,
  expandPlacement,
  motionFrames,
  originShifted,
  placeChip,
  shrinkToChip,
  layoutFromSaved,
  resolveLayout,
  resolvePlacement,
  selectionCssRect,
  selectionFromPointers,
  type ScreenInfo,
} from "./geometry";

const primary: ScreenInfo = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  work: { x: 0, y: 0, width: 1920, height: 1040 },
  scale: 1,
  primary: true,
};

describe("default placement", () => {
  it("centers a 336 by 492 board in the work area", () => {
    expect(defaultPlacement(primary.work, 1)).toEqual({
      x: (1920 - DEFAULT_WIDTH) / 2,
      y: (1040 - DEFAULT_HEIGHT) / 2,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  });

  it("shrinks the board when the work area is shorter than the default", () => {
    const work = { x: 0, y: 0, width: 1920, height: 400 };
    expect(defaultPlacement(work, 1)).toEqual({
      x: (1920 - DEFAULT_WIDTH) / 2,
      y: 0,
      width: DEFAULT_WIDTH,
      height: 400,
    });
  });

  it("keeps logical size and converts the center with the scale factor", () => {
    const work = { x: 0, y: 0, width: 2000, height: 1400 };
    expect(defaultPlacement(work, 2)).toEqual({
      x: 664,
      y: 208,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  });

  it("does not go below the minimum when the screen is tiny", () => {
    const placed = defaultPlacement({ x: 0, y: 0, width: 100, height: 100 }, 1);
    expect(placed.width).toBe(MIN_WIDTH);
    expect(placed.height).toBe(MIN_HEIGHT);
  });
});

describe("restore placement", () => {
  const side: ScreenInfo = {
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    work: { x: 1920, y: 0, width: 2560, height: 1400 },
    scale: 2,
    primary: false,
  };
  const screens = [primary, side];

  it("puts the board back where it was when it still touches a screen", () => {
    const saved = { x: 1800, y: 100, width: 400, height: 500 };
    expect(resolvePlacement(saved, screens)).toEqual(saved);
  });

  it("keeps a board that lives on the secondary monitor", () => {
    const saved = { x: 2000, y: 80, width: 400, height: 520 };
    expect(resolvePlacement(saved, screens)).toEqual(saved);
  });

  it("falls back to the primary work area when the saved window misses every screen", () => {
    expect(resolvePlacement({ x: -8000, y: -8000, width: 336, height: 492 }, screens)).toEqual(
      defaultPlacement(primary.work, 1),
    );
  });

  it("lifts a tiny saved size up to the minimum", () => {
    expect(resolvePlacement({ x: 20, y: 30, width: 10, height: 10 }, screens)).toEqual({
      x: 20,
      y: 30,
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    });
  });

  it("uses the default when nothing was saved", () => {
    expect(resolvePlacement(null, screens)).toEqual(defaultPlacement(primary.work, 1));
    expect(resolvePlacement(null, [])).toEqual({
      x: 80,
      y: 80,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  });

  it("treats the previous 420 by 640 default as the new default size", () => {
    expect(resolvePlacement({ x: 20, y: 30, width: 420, height: 640 }, screens)).toEqual({
      x: 20,
      y: 30,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  });

  it("recenters a window that was still at the old default center", () => {
    const oldCenter = {
      x: (1920 - 420) / 2,
      y: (1040 - 640) / 2,
      width: 420,
      height: 640,
    };
    expect(resolvePlacement(oldCenter, screens)).toEqual(defaultPlacement(primary.work, 1));
  });
});

describe("clamp to work area", () => {
  it("slides a hanging window back onto the work area", () => {
    expect(
      clampToWorkArea({ x: 1800, y: 1000, width: 336, height: 492 }, primary.work, 1),
    ).toEqual({ x: 1920 - 336, y: 1040 - 492, width: 336, height: 492 });
  });

  it("uses physical pixels when the scale is not 1", () => {
    const work = { x: 0, y: 0, width: 2000, height: 1400 };
    expect(clampToWorkArea({ x: 1900, y: 0, width: 336, height: 492 }, work, 2)).toEqual({
      x: 2000 - 336 * 2,
      y: 0,
      width: 336,
      height: 492,
    });
  });
});

describe("collapse and expand", () => {
  const screens = [primary];
  const board = { x: 400, y: 200, width: 336, height: 492 };

  it("puts a first-time chip at the board origin", () => {
    expect(collapsePlacement(board, null, screens)).toEqual({
      x: 400,
      y: 200,
      width: CHIP_WIDTH,
      height: CHIP_HEIGHT,
      dock: null,
    });
  });

  it("reuses a remembered chip that is still on screen", () => {
    expect(collapsePlacement(board, { x: 1600, y: 900 }, screens)).toEqual({
      x: 1600,
      y: 900,
      width: CHIP_WIDTH,
      height: CHIP_HEIGHT,
      dock: null,
    });
  });

  it("clamps a chip that would hang off the work area", () => {
    // 同时超出右、下边时，优先吸附伸出更多的右边，窗口完全留在工作区。
    expect(collapsePlacement(board, { x: 1900, y: 1030 }, screens)).toEqual({
      x: 1920 - DOCK_SIDE_WIDTH,
      y: 1040 - DOCK_SIDE_HEIGHT,
      width: DOCK_SIDE_WIDTH,
      height: DOCK_SIDE_HEIGHT,
      dock: "right",
    });
  });

  it("returns to the remembered chip after the board was translated to fit", () => {
    const home = { x: 1800, y: 200 };
    const expanded = expandPlacement(board, home, screens);
    expect(expanded.x).toBe(1920 - 336);
    expect(expanded.y).toBe(200);
    const collapsed = collapsePlacement(expanded, home, screens);
    // 1800 已贴齐 120 宽胶囊的右边，收起时应吸附为右边标签，而不是停在平移后的 1584。
    expect(collapsed.x).toBe(1920 - DOCK_SIDE_WIDTH);
    expect(collapsed.y).toBe(200);
    expect(collapsed.dock).toBe("right");
    expect(collapsed.x).not.toBe(expanded.x);
  });

  it("opens the board down and right from the chip origin", () => {
    expect(expandPlacement(board, { x: 400, y: 200 }, screens)).toEqual({
      x: 400,
      y: 200,
      width: 336,
      height: 492,
    });
  });

  it("keeps the chip as the origin even when the saved board was elsewhere", () => {
    expect(expandPlacement(board, { x: 1500, y: 80 }, screens)).toEqual({
      x: 1500,
      y: 80,
      width: 336,
      height: 492,
    });
  });

  it("does not jump back to a saved board that merely overlapped the chip", () => {
    const saved = { x: 1416, y: 18, width: 336, height: 492 };
    expect(expandPlacement(saved, { x: 1500, y: 80 }, screens)).toEqual({
      x: 1500,
      y: 80,
      width: 336,
      height: 492,
    });
  });

  it("shifts left and up just enough when a two-column board would leave the work area", () => {
    expect(expandPlacement(board, { x: 1800, y: 900 }, screens)).toEqual({
      x: 1920 - 336,
      y: 1040 - 492,
      width: 336,
      height: 492,
    });
  });

  it("shifts only left when the chip is near the right edge but has room below", () => {
    expect(expandPlacement(board, { x: 1800, y: 80 }, screens)).toEqual({
      x: 1920 - 336,
      y: 80,
      width: 336,
      height: 492,
    });
  });

  it("lifts a previously clamped size back to the two-column default", () => {
    expect(expandPlacement({ x: 10, y: 10, width: 200, height: 200 }, { x: 400, y: 200 }, screens)).toEqual({
      x: 400,
      y: 200,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
  });

  it("keeps a user-enlarged board size when there is room", () => {
    const saved = { x: 10, y: 10, width: 420, height: 560 };
    expect(expandPlacement(saved, { x: 200, y: 100 }, screens)).toEqual({
      x: 200,
      y: 100,
      width: 420,
      height: 560,
    });
  });

  it("shrinks the chip in place from the board origin", () => {
    expect(shrinkToChip(board, screens)).toEqual({
      x: 400,
      y: 200,
      width: CHIP_WIDTH,
      height: CHIP_HEIGHT,
    });
  });

  it("places a collapsed launch without a chip at the board origin", () => {
    const layout = resolveLayout({ board, chip: null, collapsed: true }, screens);
    expect(layout.collapsed).toBe(true);
    expect(layout.chip).toEqual({ x: 400, y: 200 });
    expect(layout.board).toEqual(board);
  });

  it("restores a collapsed chip position on launch", () => {
    const layout = resolveLayout({ board, chip: { x: 1600, y: 900 }, collapsed: true }, screens);
    expect(layout.chip).toEqual({ x: 1600, y: 900 });
    expect(layout.collapsed).toBe(true);
  });

  it("places a first-run default chip in the lower right", () => {
    expect(defaultChipPlacement(primary.work, 1)).toEqual({
      x: 1920 - CHIP_WIDTH - 28,
      y: 1040 - CHIP_HEIGHT - 28,
    });
  });
});

describe("docked chip", () => {
  const screens = [primary];

  it("does not dock a chip sitting in the middle", () => {
    expect(placeChip({ x: 400, y: 200 }, screens, true)).toEqual({
      x: 400,
      y: 200,
      width: CHIP_WIDTH,
      height: CHIP_HEIGHT,
      dock: null,
    });
  });

  it("snaps to a right tab fully inside the work area", () => {
    const placed = placeChip({ x: 1900, y: 300 }, screens, true);
    expect(placed).toEqual({
      x: 1920 - DOCK_SIDE_WIDTH,
      y: 300,
      width: DOCK_SIDE_WIDTH,
      height: DOCK_SIDE_HEIGHT,
      dock: "right",
    });
    expect(placed.x + placed.width).toBe(1920);
    expect(placed.y).toBeGreaterThanOrEqual(0);
    expect(placed.y + placed.height).toBeLessThanOrEqual(1040);
  });

  it("snaps to a left tab fully inside the work area", () => {
    const placed = placeChip({ x: -20, y: 400 }, screens, true);
    expect(placed).toEqual({
      x: 0,
      y: 400,
      width: DOCK_SIDE_WIDTH,
      height: DOCK_SIDE_HEIGHT,
      dock: "left",
    });
  });

  it("snaps to a top tab fully inside the work area", () => {
    const placed = placeChip({ x: 500, y: -10 }, screens, true);
    expect(placed).toEqual({
      x: 500,
      y: 0,
      width: DOCK_EDGE_WIDTH,
      height: DOCK_EDGE_HEIGHT,
      dock: "top",
    });
  });

  it("snaps to a bottom tab above the taskbar, not the screen edge", () => {
    const placed = placeChip({ x: 500, y: 1020 }, screens, true);
    expect(placed).toEqual({
      x: 500,
      y: 1040 - DOCK_EDGE_HEIGHT,
      width: DOCK_EDGE_WIDTH,
      height: DOCK_EDGE_HEIGHT,
      dock: "bottom",
    });
    expect(placed.y + placed.height).toBe(1040);
  });

  it("snaps when released close to an edge but still on screen", () => {
    const placed = placeChip({ x: 1920 - CHIP_WIDTH - CHIP_SNAP_DISTANCE, y: 200 }, screens, true);
    expect(placed.dock).toBe("right");
    expect(placed.x + placed.width).toBe(1920);
  });

  it("does not snap a default inset chip", () => {
    const home = defaultChipPlacement(primary.work, 1);
    expect(placeChip(home, screens, true).dock).toBeNull();
  });

  it("infers a saved right-dock position without a fresh snap", () => {
    const placed = placeChip({ x: 1920 - DOCK_SIDE_WIDTH, y: 240 }, screens, false);
    expect(placed.dock).toBe("right");
    expect(placed.x).toBe(1920 - DOCK_SIDE_WIDTH);
  });
});

describe("saved layout", () => {
  it("reads chip coordinates from the persisted window row", () => {
    expect(
      layoutFromSaved({
        x: 10,
        y: 20,
        width: 336,
        height: 492,
        collapsed: true,
        chipX: 80,
        chipY: 90,
      }),
    ).toEqual({
      board: { x: 10, y: 20, width: 336, height: 492 },
      chip: { x: 80, y: 90 },
      collapsed: true,
    });
  });

  it("treats a legacy row without chip fields as an expanded board", () => {
    expect(layoutFromSaved({ x: 10, y: 20, width: 420, height: 640 })).toEqual({
      board: { x: 10, y: 20, width: 420, height: 640 },
      chip: null,
      collapsed: false,
    });
  });
});

describe("screenshot selection", () => {
  it("normalizes a drag that goes up and left", () => {
    expect(selectionFromPointers({ x: 100, y: 80 }, { x: 40, y: 20 })).toEqual({
      x: 40,
      y: 20,
      width: 60,
      height: 60,
    });
  });

  it("rejects a selection smaller than 8 physical pixels", () => {
    expect(selectionFromPointers({ x: 0, y: 0 }, { x: 8, y: 7 })).toBeNull();
    expect(selectionFromPointers({ x: 0, y: 0 }, { x: 8, y: 8 })).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
  });

  it("rounds the physical rectangle", () => {
    expect(selectionFromPointers({ x: 1.2, y: 3.4 }, { x: 9.8, y: 13.6 })).toEqual({
      x: 1,
      y: 3,
      width: 9,
      height: 10,
    });
  });

  it("maps the selection into one monitor's CSS pixels", () => {
    const css = selectionCssRect(
      { x: 1100, y: 300, width: 200, height: 100 },
      { x: 1000, y: 200, width: 800, height: 600, scale: 2 },
    );
    expect(css).toEqual({ left: 50, top: 50, width: 100, height: 50 });
  });

  it("returns null when the selection misses that monitor", () => {
    expect(
      selectionCssRect(
        { x: 0, y: 0, width: 40, height: 40 },
        { x: 1000, y: 0, width: 800, height: 600, scale: 1 },
      ),
    ).toBeNull();
  });
});

describe("collapse target and motion frames", () => {
  const screens = [primary];
  const midBoard = { x: 400, y: 200, width: 336, height: 492 };
  const midHome = { x: 400, y: 200 };

  it("treats a 1px origin difference as not shifted", () => {
    expect(originShifted({ x: 400, y: 200 }, { x: 401, y: 200 })).toBe(false);
    expect(originShifted({ x: 400, y: 200 }, { x: 400, y: 201 })).toBe(false);
    expect(originShifted({ x: 1337, y: 222 }, { x: 1794, y: 320 })).toBe(true);
  });

  it("shrinks in place when there is enough space and the board is still at the chip", () => {
    const target = collapseTarget(midBoard, midHome, screens);
    expect(target).toEqual({
      x: 400,
      y: 200,
      width: CHIP_WIDTH,
      height: CHIP_HEIGHT,
      dock: null,
    });
  });

  it("locks the current origin even if home is 1px off from DPI rounding", () => {
    const target = collapseTarget(midBoard, { x: 401, y: 201 }, screens);
    expect(target.x).toBe(400);
    expect(target.y).toBe(200);
    expect(target.width).toBe(CHIP_WIDTH);
    expect(target.height).toBe(CHIP_HEIGHT);
    expect(target.dock).toBeNull();
  });

  it("returns to the remembered docked chip only after a translated expand", () => {
    const home = { x: 1800, y: 200 };
    const expanded = expandPlacement(midBoard, home, screens);
    expect(expanded.x).not.toBe(home.x);
    const target = collapseTarget(expanded, home, screens);
    expect(target.x).toBe(1920 - DOCK_SIDE_WIDTH);
    expect(target.y).toBe(200);
    expect(target.dock).toBe("right");
    expect(target.x).not.toBe(expanded.x);
  });

  it("keeps a left-docked origin and only changes size when there is room to the right", () => {
    const home = { x: 0, y: 320, width: DOCK_SIDE_WIDTH, height: DOCK_SIDE_HEIGHT };
    const expanded = expandPlacement(midBoard, home, screens);
    expect(expanded.x).toBe(0);
    expect(expanded.y).toBe(320);
    const target = collapseTarget(expanded, home, screens);
    expect(target.x).toBe(0);
    expect(target.y).toBe(320);
    expect(target.dock).toBe("left");
    expect(target.width).toBe(DOCK_SIDE_WIDTH);
    expect(target.height).toBe(DOCK_SIDE_HEIGHT);
  });

  function assertMonotone(values: number[], dir: "up" | "down" | "any") {
    for (let i = 1; i < values.length; i += 1) {
      if (dir === "up") expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
      else if (dir === "down") expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  }

  it("locks x/y and only shrinks size when space is enough", () => {
    const from = { x: 520, y: 200, width: 389.3333333333333, height: 532 };
    const to = { x: 520, y: 200, width: CHIP_WIDTH, height: CHIP_HEIGHT };
    const frames = motionFrames(from, to, 1.5, 10);
    expect(frames).toHaveLength(10);
    expect(frames.every((frame) => frame.x === 520 && frame.y === 200)).toBe(true);
    assertMonotone(
      frames.map((frame) => frame.width),
      "down",
    );
    assertMonotone(
      frames.map((frame) => frame.height),
      "down",
    );
    const last = frames[frames.length - 1];
    expect(last).toEqual({ x: 520, y: 200, width: Math.round(CHIP_WIDTH * 1.5), height: Math.round(CHIP_HEIGHT * 1.5) });
    // 1px 的目标偏移也不能带跑左上角
    const almost = motionFrames(from, { x: 521, y: 201, width: CHIP_WIDTH, height: CHIP_HEIGHT }, 1.5, 10);
    expect(almost.every((frame) => frame.x === 520 && frame.y === 200)).toBe(true);
  });

  it("moves x/y/w/h together and monotonically when returning to a right-dock home", () => {
    const from = { x: 1337, y: 222, width: 584 / 1.5, height: 798 / 1.5 };
    const to = { x: 1794, y: 320, width: DOCK_SIDE_WIDTH, height: DOCK_SIDE_HEIGHT };
    const frames = motionFrames(from, to, 1.5, 10);
    expect(frames).toHaveLength(10);
    assertMonotone(
      frames.map((frame) => frame.x),
      "up",
    );
    assertMonotone(
      frames.map((frame) => frame.y),
      "up",
    );
    assertMonotone(
      frames.map((frame) => frame.width),
      "down",
    );
    assertMonotone(
      frames.map((frame) => frame.height),
      "down",
    );
    assertMonotone(
      frames.map((frame) => frame.x + frame.width),
      "any",
    );
    const rights = frames.map((frame) => frame.x + frame.width);
    const bottoms = frames.map((frame) => frame.y + frame.height);
    for (let i = 2; i < rights.length; i += 1) {
      const d1 = rights[i - 1] - rights[i - 2];
      const d2 = rights[i] - rights[i - 1];
      if (Math.abs(d1) >= 1 && Math.abs(d2) >= 1) {
        expect(Math.sign(d1)).toBe(Math.sign(d2));
      }
    }
    for (let i = 2; i < bottoms.length; i += 1) {
      const d1 = bottoms[i - 1] - bottoms[i - 2];
      const d2 = bottoms[i] - bottoms[i - 1];
      if (Math.abs(d1) >= 1 && Math.abs(d2) >= 1) {
        expect(Math.sign(d1)).toBe(Math.sign(d2));
      }
    }
    const last = frames[frames.length - 1];
    expect(last).toEqual({
      x: 1794,
      y: 320,
      width: Math.round(DOCK_SIDE_WIDTH * 1.5),
      height: Math.round(DOCK_SIDE_HEIGHT * 1.5),
    });
  });
});
