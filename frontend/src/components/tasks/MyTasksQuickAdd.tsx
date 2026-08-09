/**
 * 我的任务 · 快速添加（桌面完整表单 / 移动端简条）
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { Briefcase, Maximize2, Plus, User } from "lucide-react";
import type { Project, Tag } from "@/types";
import { Button } from "@/components/ui/button";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import RecurrenceConfigurator, { type RecurrenceRule } from "@/components/common/RecurrenceConfigurator";
import GenericTagInput from "@/components/GenericTagInput";
import TaskCategoryPicker from "@/components/TaskCategoryPicker";
import QuadrantPicker from "@/components/QuadrantPicker";
import MentionPicker, { useMentionState, replaceMentionText } from "@/components/MentionPicker";

export type MyTasksQuickAddValues = {
  title: string;
  projId: string;
  assigneeId: string;
  dueDate: string;
  categoryId: string | null;
  isImportant: number | null;
  isUrgent: number | null;
  isPersonal: boolean;
  tags: Tag[];
  isRecurring: boolean;
  recurrenceRule: RecurrenceRule;
  cursorPos: number;
};

export type MyTasksQuickAddProps = {
  values: MyTasksQuickAddValues;
  onChange: (patch: Partial<MyTasksQuickAddValues>) => void;
  projects: Project[];
  personalTodoProject?: Project | null;
  currentUserId: string;
  wsMembers: any[];
  onSubmit: (e: React.FormEvent) => void;
  onOpenDetailed: () => void;
  /** desktop = 完整表单；mobile = 单行简条 */
  variant?: "desktop" | "mobile";
};

export default function MyTasksQuickAdd({
  values,
  onChange,
  projects,
  personalTodoProject,
  currentUserId,
  wsMembers,
  onSubmit,
  onOpenDetailed,
  variant = "desktop",
}: MyTasksQuickAddProps) {
  const { t } = useTranslation();
  const mention = useMentionState(values.title, values.cursorPos);

  if (variant === "mobile") {
    return (
      <form
        onSubmit={onSubmit}
        className="md:hidden flex items-center gap-2 w-full max-w-[640px] mx-auto bg-app-elevated border border-app-border/50 rounded-xl px-3 py-2 shadow-xs"
      >
        <Plus size={16} className="text-accent-primary shrink-0" />
        {/* 原生 input，去掉 ui/Input 默认 border/ring 叠出第二层框 */}
        <input
          type="text"
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={t("projects.quickAddTaskPlaceholder") || "添加任务，回车创建"}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none shadow-none ring-0 focus:ring-0 focus:outline-none px-0 text-sm h-9 text-tx-primary placeholder:text-tx-tertiary"
        />
        <button
          type="button"
          onClick={onOpenDetailed}
          className="p-2 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-tx-tertiary hover:bg-app-hover shrink-0"
          title="详细创建"
        >
          <Maximize2 size={16} />
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="hidden md:block bg-app-elevated border border-app-border/40 rounded-xl p-4 space-y-3 shadow-sm w-full max-w-[640px] mx-auto"
    >
      <div className="flex items-center gap-3 relative">
        <div className="w-6 h-6 rounded-full border border-app-border flex items-center justify-center shrink-0">
          <Plus size={14} className="text-tx-tertiary" />
        </div>
        <input
          type="text"
          value={values.title}
          onChange={(e) => {
            onChange({
              title: e.target.value,
              cursorPos: e.target.selectionStart || 0,
            });
          }}
          onKeyUp={(e) => onChange({ cursorPos: e.currentTarget.selectionStart || 0 })}
          onClick={(e) => onChange({ cursorPos: e.currentTarget.selectionStart || 0 })}
          placeholder={
            t("projects.quickAddTaskPlaceholder") ||
            "快速添加任务（输入标题后按回车或点击右侧添加）..."
          }
          className="flex-1 min-w-0 bg-transparent border-0 outline-none shadow-none ring-0 focus:ring-0 focus:outline-none px-0 pr-8 text-sm placeholder:text-tx-tertiary text-tx-primary h-8"
        />
        <button
          type="button"
          onClick={onOpenDetailed}
          className="p-1.5 hover:bg-app-hover rounded text-tx-tertiary hover:text-tx-primary transition-colors absolute right-1"
          title="全屏创建任务"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {mention && (
        <div className="relative z-50">
          <MentionPicker
            search={mention.search}
            onSelect={(user) => {
              const newText = replaceMentionText(
                values.title,
                values.cursorPos,
                mention.startIndex,
                user.username,
              );
              onChange({
                title: newText,
                cursorPos: mention.startIndex + user.username.length + 2,
              });
              mention.clear();
            }}
            onClose={mention.clear}
          />
        </div>
      )}

      <div className="pt-3 border-t border-app-border/20 space-y-2.5">
        {/* 行 1：项目 / 指派 / 截止 */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 bg-app-sidebar border border-app-border/60 px-2.5 py-1 rounded-xl text-xs text-tx-secondary hover:bg-app-hover transition-colors shrink-0">
            <input
              type="checkbox"
              checked={values.isPersonal}
              onChange={(e) => {
                const isPersonal = e.target.checked;
                if (isPersonal && personalTodoProject) {
                  onChange({ isPersonal: true, projId: personalTodoProject.id });
                } else {
                  const nonPersonal = projects.filter((p) => p.id !== personalTodoProject?.id);
                  onChange({
                    isPersonal: false,
                    projId: nonPersonal[0]?.id || values.projId,
                  });
                }
              }}
              className="w-3.5 h-3.5 rounded cursor-pointer accent-accent-primary"
            />
            {values.isPersonal && personalTodoProject ? (
              <div className="flex items-center gap-1">
                <Briefcase size={12} className="text-accent-primary" />
                <span className="font-semibold text-tx-primary">{personalTodoProject.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Briefcase size={12} className="text-tx-tertiary" />
                <select
                  value={values.projId}
                  onChange={(e) => {
                    const newProjId = e.target.value;
                    onChange({
                      projId: newProjId,
                      isPersonal:
                        newProjId && newProjId !== personalTodoProject?.id
                          ? false
                          : values.isPersonal,
                    });
                  }}
                  className="bg-transparent border-0 focus:outline-none text-xs text-tx-secondary cursor-pointer font-semibold"
                >
                  {projects.filter((p) => p.id !== personalTodoProject?.id).length > 0 ? (
                    projects
                      .filter((p) => p.id !== personalTodoProject?.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))
                  ) : (
                    <option value="" disabled>
                      {t("projects.noProjectAvailable") || "无可用项目"}
                    </option>
                  )}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 bg-app-sidebar border border-app-border/60 px-2.5 py-1 rounded-xl text-xs text-tx-secondary hover:bg-app-hover transition-colors shrink-0">
            <User size={12} className="text-tx-tertiary" />
            <select
              value={values.assigneeId}
              onChange={(e) => onChange({ assigneeId: e.target.value })}
              className="bg-transparent border-0 focus:outline-none text-xs text-tx-secondary cursor-pointer font-semibold"
            >
              <option value={currentUserId}>{t("projects.assigneeMe") || "指派给：我自己"}</option>
              {wsMembers
                .filter((m) => m.userId !== currentUserId)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName || m.username}
                  </option>
                ))}
            </select>
          </div>

          <div className="flex items-center bg-app-sidebar border border-app-border/60 px-2.5 py-1 rounded-xl text-xs text-tx-secondary hover:bg-app-hover transition-colors shrink-0">
            <SleekDatePicker
              value={values.dueDate}
              onChange={(v) => onChange({ dueDate: v })}
              placeholder={t("projects.dueDate") || "截止日期"}
              showTime={true}
              variant="ghost"
              className="w-full"
            />
          </div>
        </div>

        {/* 行 2：事务分类 + 四象限（马上做 / 计划做 / 能转就转 / 少做） */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <TaskCategoryPicker
            value={values.categoryId}
            onChange={(id) => onChange({ categoryId: id })}
            compact
          />
          <QuadrantPicker
            compact
            isImportant={values.isImportant}
            isUrgent={values.isUrgent}
            onChange={({ isImportant, isUrgent }) => onChange({ isImportant, isUrgent })}
          />
        </div>

        {/* 行 3：标签 + 添加 */}
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <div className="flex-1 max-w-[400px]">
            <GenericTagInput
              selectedTags={values.tags}
              onTagsChange={(tags) => onChange({ tags })}
              placeholder="添加标签..."
              className="border-0 shadow-none bg-app-sidebar/40 py-0.5"
            />
          </div>

          <Button
            type="submit"
            disabled={!values.title.trim() || (!values.isPersonal && !values.projId)}
            className="h-8 text-xs font-semibold px-4 rounded-xl bg-accent-primary hover:bg-accent-primary/95 text-white disabled:opacity-40 disabled:pointer-events-none transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shadow-sm shrink-0"
          >
            {t("common.add") || "添加"}
          </Button>
        </div>
      </div>

      <div className="mt-2.5 pt-2 border-t border-app-border/20">
        <RecurrenceConfigurator
          isRecurring={values.isRecurring}
          onChangeRecurring={(v) => onChange({ isRecurring: v })}
          rule={values.recurrenceRule}
          onChangeRule={(rule) => onChange({ recurrenceRule: rule })}
          compact={true}
        />
      </div>
    </form>
  );
}
