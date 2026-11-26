export interface OrderedCard {
  sortOrder: number;
  createdAt: number;
}

/** 和后端的自动编号前缀一致：正文用「文字」，截图保留「截图」，其他图片用「图片」。 */
export function namePrefix(kind: "text" | "image", title: string | null | undefined): "文字" | "图片" | "截图" {
  if (kind === "text") return "文字";
  if (title && /^截图[1-9]\d*$/.test(title.trim())) return "截图";
  return "图片";
}

export function displayName(title: string | null | undefined): string {
  const trimmed = title?.trim() ?? "";
  return trimmed ? trimmed : "未命名";
}

export function orderedCards<T extends OrderedCard>(cards: T[]): T[] {
  return [...cards].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
}

/** 卡片上的缩略文字。按字数截断，避免把整篇正文塞进看板。 */
export function previewText(body: string, limit = 240): string {
  const trimmed = body.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= limit) return trimmed;
  return `${chars.slice(0, limit).join("")}…`;
}
