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
