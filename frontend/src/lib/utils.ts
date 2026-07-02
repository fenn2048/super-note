import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 检测输入文本是否包含 @su 标记。
 * 若包含，返回 { hasSu: true, cleanText: 去掉 @su 后的内容 }
 * 否则返回 { hasSu: false, cleanText: 原文 }
 */
export function detectSuMention(text: string): { hasSu: boolean; cleanText: string } {
  const idx = text.indexOf("@su");
  if (idx === -1) return { hasSu: false, cleanText: text };
  // 去掉 @su 标记及周围可能的空白
  const cleaned = text.replace(/@su\s*/g, "").trim();
  return { hasSu: true, cleanText: cleaned || text };
}

/**
 * 获取标签颜色，若无有效自定义颜色，则根据标签名字/ID 哈希到一个预设的高级色盘
 */
export function getTagColor(tag: { id: string; name: string; color?: string | null }): string {
  if (tag.color && tag.color !== "#58a6ff" && tag.color !== "") {
    return tag.color;
  }
  const colors = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981", "#14b8a6",
    "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f43f5e"
  ];
  let hash = 0;
  const str = tag.name || tag.id || "";
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}
