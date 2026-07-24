/**
 * 功能模块包（P2-4）
 * ---------------------------------------------------------------------------
 * 首次向导选择后写入 localStorage，与 workspace features 叠加过滤导航。
 * 无 pack 键 / full = 全开（兼容老用户）。
 */
export type ModulePackId = "minimal" | "family" | "creator" | "full";

const STORAGE_KEY = "fuyou.module-pack";

/** 各包允许的 nav module id（与 navigation.config 的 id 对齐） */
const PACK_MODULES: Record<ModulePackId, Set<string> | null> = {
  // null = 不限制（全开）
  full: null,
  minimal: new Set([
    "home",
    "notes",
    "favorites",
    "trash",
    "files",
    "library",
  ]),
  family: new Set([
    "home",
    "notes",
    "tasks",
    "diary",
    "favorites",
    "trash",
    "files",
    "library",
    "mentions",
    "ai",
    "finance",
  ]),
  creator: new Set([
    "home",
    "notes",
    "tasks",
    "diary",
    "ai",
    "library",
    "files",
    "books",
    "media",
    "favorites",
    "trash",
    "mentions",
    "finance",
  ]),
};

export const MODULE_PACK_META: Array<{
  id: ModulePackId;
  label: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    id: "minimal",
    label: "极简笔记",
    description: "笔记、收藏、回收站与文件，专注记录",
  },
  {
    id: "family",
    label: "家庭协作",
    description: "笔记 + 任务 + 说说 + 消息，适合家庭共用",
    recommended: true,
  },
  {
    id: "creator",
    label: "创作 + AI",
    description: "在家庭协作上增加 AI 与资料库（书/媒体）",
  },
  {
    id: "full",
    label: "全功能",
    description: "开放全部模块入口",
  },
];

export function getModulePack(): ModulePackId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "minimal" || v === "family" || v === "creator" || v === "full") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "full";
}

export function setModulePack(id: ModulePackId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent("super:module-pack-changed", { detail: { pack: id } }),
  );
}

/** 模块 id 是否被当前 pack 允许 */
export function isModuleAllowedByPack(moduleId: string, pack?: ModulePackId): boolean {
  const p = pack ?? getModulePack();
  const allow = PACK_MODULES[p];
  if (!allow) return true;
  // library 子项：若 pack 含 library 则 files/books/media 也放行
  if (
    (moduleId === "files" || moduleId === "books" || moduleId === "media") &&
    allow.has("library")
  ) {
    return true;
  }
  return allow.has(moduleId);
}
