/**
 * CreateMenu 纯逻辑（便于单测 / 模块包过滤）
 */
import type { ModulePackId } from "@/lib/modulePack";
import { isModuleAllowedByPack } from "@/lib/modulePack";

export type CreateMenuAction = "note" | "diary" | "task" | "camera";

export interface CreateMenuItemDef {
  key: CreateMenuAction;
  label: string;
  /** 对应 navigation module id；camera 无模块 */
  moduleId?: string;
}

export const CREATE_MENU_DEFS: CreateMenuItemDef[] = [
  { key: "note", label: "新建笔记", moduleId: "notes" },
  { key: "diary", label: "写说说", moduleId: "diary" },
  { key: "task", label: "新建任务", moduleId: "tasks" },
  { key: "camera", label: "拍照" },
];

/**
 * 按模块包与是否展示相机过滤创建项
 */
export function filterCreateMenuItems(opts: {
  showCamera?: boolean;
  pack?: ModulePackId;
}): CreateMenuItemDef[] {
  const showCamera = opts.showCamera !== false;
  return CREATE_MENU_DEFS.filter((item) => {
    if (item.key === "camera") return showCamera;
    if (item.moduleId && !isModuleAllowedByPack(item.moduleId, opts.pack)) {
      return false;
    }
    return true;
  });
}
