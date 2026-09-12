import type { ImCardKind, ImCardPayload } from "@/types";

const CARD_LABEL: Record<ImCardKind, string> = {
  note: "笔记",
  diary: "说说",
  task: "任务",
};

export function parseImCard(body: string | null | undefined): ImCardPayload | null {
  if (!body) return null;
  try {
    const raw = JSON.parse(body) as Partial<ImCardPayload>;
    if (raw.kind !== "note" && raw.kind !== "diary" && raw.kind !== "task") return null;
    if (typeof raw.id !== "string" || !raw.id.trim()) return null;
    return {
      kind: raw.kind,
      id: raw.id.trim(),
      title: typeof raw.title === "string" ? raw.title : "",
      snippet: typeof raw.snippet === "string" ? raw.snippet : undefined,
      label: CARD_LABEL[raw.kind],
    };
  } catch {
    return null;
  }
}

export function cardPreview(body: string | null | undefined): string {
  const card = parseImCard(body);
  if (!card) return "[卡片]";
  const title = (card.title || "").trim() || "未命名";
  const text = `[${card.label}] ${title}`;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** 点击聊天卡片：复用通知/仪表盘的 pending-navigate。 */
export function openSharedItem(kind: ImCardKind, id: string): void {
  try {
    sessionStorage.setItem(
      "super:pending-navigate",
      JSON.stringify({ sourceType: kind, sourceId: id }),
    );
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(new Event("super:navigate-to-item-trigger"));
}

export function isFamilyWorkspace(workspaceId?: string | null): boolean {
  const ws = workspaceId ?? "";
  return Boolean(ws && ws !== "personal");
}
