import { describe, expect, it } from "vitest";
import { renderCardHtml } from "./view";
import type { Card } from "./types";

const base: Card = {
  id: "c1",
  kind: "text",
  title: "文字1",
  body: "下午三点前把材料发给王经理",
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
  thumbPngBase64: null,
};

describe("board card face", () => {
  it("shows the name, preview, and pin / copy / delete actions", () => {
    const html = renderCardHtml(base);
    expect(html).toContain("文字1");
    expect(html).toContain("下午三点前把材料发给王经理");
    expect(html).toContain("置顶");
    expect(html).toContain("复制");
    expect(html).toContain("删除");
    expect(html).toContain('data-act="top"');
    expect(html).toContain('data-act="copy"');
    expect(html).toContain('data-act="delete"');
    expect(html).not.toContain("确认删除");
  });

  it("wraps an image thumbnail with the same face actions", () => {
    const html = renderCardHtml({
      ...base,
      id: "pic",
      kind: "image",
      title: "截图1",
      body: "",
      thumbPngBase64: "abc",
    });
    expect(html).toContain("截图1");
    expect(html).toContain('class="thumb"');
    expect(html).toContain("置顶");
    expect(html).toContain("复制");
    expect(html).toContain("删除");
  });
});
