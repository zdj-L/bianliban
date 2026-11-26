import { describe, expect, it } from "vitest";
import { displayName, namePrefix, orderedCards, previewText } from "./cards";

describe("display name", () => {
  it("uses the stored name", () => {
    expect(displayName("  会议  ")).toBe("会议");
  });

  it("falls back when a card from the old app has no name", () => {
    expect(displayName(null)).toBe("未命名");
    expect(displayName("   ")).toBe("未命名");
    expect(displayName(undefined)).toBe("未命名");
  });
});

describe("name prefix", () => {
  it("picks the sequence that matches the card", () => {
    expect(namePrefix("text", null)).toBe("文字");
    expect(namePrefix("text", "会议")).toBe("文字");
    expect(namePrefix("image", "截图2")).toBe("截图");
    expect(namePrefix("image", "截图01")).toBe("图片");
    expect(namePrefix("image", "照片")).toBe("图片");
    expect(namePrefix("image", null)).toBe("图片");
  });
});

describe("order", () => {
  it("sorts by sort order, then creation time", () => {
    const cards = orderedCards([
      { id: "b", sortOrder: 1, createdAt: 2 },
      { id: "a", sortOrder: 0, createdAt: 5 },
      { id: "c", sortOrder: 1, createdAt: 1 },
    ]);
    expect(cards.map((card) => card.id)).toEqual(["a", "c", "b"]);
  });
});

describe("preview text", () => {
  it("trims and keeps short notes intact", () => {
    expect(previewText("  一行\n两行  ")).toBe("一行\n两行");
  });

  it("counts characters, not bytes", () => {
    expect(previewText("字".repeat(5), 3)).toBe("字字字…");
  });
});
