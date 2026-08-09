/**
 * 统一任务详细创建表单（桌面弹层 / 移动 BottomSheet 共用）
 */
import React, { useRef, useState } from "react";
import type { Project, Tag } from "@/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import TextareaFormatToolbar from "@/components/common/TextareaFormatToolbar";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import ReminderOffsetPicker from "@/components/common/ReminderOffsetPicker";
import RecurrenceConfigurator, { type RecurrenceRule } from "@/components/common/RecurrenceConfigurator";
import GenericTagInput from "@/components/GenericTagInput";
import TaskCategoryPicker from "@/components/TaskCategoryPicker";
import QuadrantPicker from "@/components/QuadrantPicker";
import { AiFormatHelper } from "@/components/AiFormatHelper";
import MentionPicker, { useMentionState, replaceMentionText } from "@/components/MentionPicker";

function formatTodayYmd() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type TaskCreateFormValues = {
  title: string;
  projectId: string;
  assigneeId: string;
  priority: number;
  dueDate: string;
  remindAt: string;
  reminderOffsetValue: number;
  reminderOffsetUnit: "minute" | "hour" | "day" | "month" | "year";
  description: string;
  tags: Tag[];
  categoryId: string | null;
  isImportant: number | null;
  isUrgent: number | null;
  isRecurring: boolean;
  recurrenceRule: RecurrenceRule;
  /** 事后补录：已做完再录入 */
  isBackfilled: boolean;
  /** 实际完成日 YYYY-MM-DD（补录时必填） */
  completedAt: string;
};

type Props = {
  values: TaskCreateFormValues;
  onChange: (patch: Partial<TaskCreateFormValues>) => void;
  projects: Project[];
  currentUserId: string;
  wsMembers: Array<{ userId: string; username?: string; displayName?: string | null }>;
  calculateDefaultReminderDate: (dateStr: string) => string;
  autoFocusTitle?: boolean;
};

export default function TaskCreateForm({
  values,
  onChange,
  projects,
  currentUserId,
  wsMembers,
  calculateDefaultReminderDate,
  autoFocusTitle = true,
}: Props) {
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [titleCursorPos, setTitleCursorPos] = useState(0);
  const [descCursorPos, setDescCursorPos] = useState(0);
  const titleMention = useMentionState(values.title, titleCursorPos);
  const descMention = useMentionState(values.description, descCursorPos);

  return (
    <div className="space-y-5 md:space-y-6 pb-2">
      <div className="space-y-2.5 relative">
        <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
          任务标题
        </label>
        <Input
          value={values.title}
          onChange={(e) => {
            onChange({ title: e.target.value });
            setTitleCursorPos(e.target.selectionStart || 0);
          }}
          onKeyUp={(e) => setTitleCursorPos(e.currentTarget.selectionStart || 0)}
          onClick={(e) => setTitleCursorPos(e.currentTarget.selectionStart || 0)}
          placeholder="输入任务标题…"
          className="h-10 text-xs border-app-border w-full rounded-xl"
          required
          autoFocus={autoFocusTitle}
        />
        <AiFormatHelper value={values.title} onChange={(title) => onChange({ title })} />
        {titleMention && (
          <div className="relative z-50">
            <MentionPicker
              search={titleMention.search}
              onSelect={(user) => {
                const newText = replaceMentionText(
                  values.title,
                  titleCursorPos,
                  titleMention.startIndex,
                  user.username,
                );
                onChange({ title: newText });
                setTitleCursorPos(titleMention.startIndex + user.username.length + 2);
                titleMention.clear();
              }}
              onClose={titleMention.clear}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
            所属项目
          </label>
          <select
            value={values.projectId}
            onChange={(e) => onChange({ projectId: e.target.value })}
            className="sleek-select w-full h-10 px-3 text-xs text-tx-secondary rounded-xl"
            required
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
            指派给
          </label>
          <select
            value={values.assigneeId}
            onChange={(e) => onChange({ assigneeId: e.target.value })}
            className="sleek-select w-full h-10 px-3 text-xs text-tx-secondary rounded-xl"
          >
            <option value={currentUserId}>我自己</option>
            {wsMembers
              .filter((m) => m.userId !== currentUserId)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName || m.username}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
          四象限 <span className="normal-case font-normal text-tx-tertiary">（可选 · 重要×紧急）</span>
        </label>
        <QuadrantPicker
          isImportant={values.isImportant}
          isUrgent={values.isUrgent}
          onChange={({ isImportant, isUrgent }) => onChange({ isImportant, isUrgent })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
            截止日期
          </label>
          <SleekDatePicker
            value={values.dueDate}
            onChange={(val) => {
              if (val) {
                onChange({
                  dueDate: val,
                  remindAt: calculateDefaultReminderDate(val),
                });
              } else {
                onChange({ dueDate: "", remindAt: "" });
              }
            }}
            className="w-full h-10 rounded-xl"
            placeholder="选择截止日期"
            showTime={true}
          />
        </div>
        <div className="space-y-2 min-w-0">
          {(values.dueDate || values.isRecurring) && (
            <>
              <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
                提醒设置
              </label>
              <ReminderOffsetPicker
                value={values.reminderOffsetValue}
                unit={values.reminderOffsetUnit}
                onChangeValue={(reminderOffsetValue) => onChange({ reminderOffsetValue })}
                onChangeUnit={(reminderOffsetUnit) => onChange({ reminderOffsetUnit })}
              />
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
          事务分类 <span className="normal-case font-normal text-tx-tertiary">（可选）</span>
        </label>
        <TaskCategoryPicker
          value={values.categoryId}
          onChange={(categoryId) => onChange({ categoryId })}
          className="w-full max-w-md"
        />
      </div>

      <div className="border-t border-app-border/40 pt-4">
        <RecurrenceConfigurator
          isRecurring={values.isRecurring}
          onChangeRecurring={(isRecurring) => onChange({ isRecurring })}
          rule={values.recurrenceRule}
          onChangeRule={(recurrenceRule) => onChange({ recurrenceRule })}
        />
      </div>

      {/* 事后补录：已做完再录入，不抬高「今天创建」 */}
      <div className="rounded-xl border border-app-border/50 bg-app-sidebar/30 p-3.5 space-y-3">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={values.isBackfilled}
            onChange={(e) => {
              const on = e.target.checked;
              onChange({
                isBackfilled: on,
                completedAt: on
                  ? values.completedAt || values.dueDate || formatTodayYmd()
                  : "",
                isRecurring: on ? false : values.isRecurring,
              });
            }}
            className="mt-0.5 w-4 h-4 rounded accent-accent-primary shrink-0"
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-tx-primary">事后补录</span>
            <span className="block text-[11px] text-tx-tertiary mt-0.5 leading-snug">
              事情已经做完，现在才记进系统。完成日写入真实日期；复盘「创建数」不计入补录，周期不参与统计。
            </span>
          </span>
        </label>
        {values.isBackfilled && (
          <div className="space-y-2 pl-6">
            <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
              实际完成日
            </label>
            <SleekDatePicker
              value={values.completedAt}
              onChange={(val) => {
                onChange({
                  completedAt: val || "",
                  // 无截止日时用完成日，方便准时率对齐
                  dueDate: values.dueDate || val || "",
                });
              }}
              className="w-full h-10 rounded-xl max-w-xs"
              placeholder="选择实际完成日"
              showTime={false}
            />
            <p className="text-[10px] text-tx-quaternary leading-snug">
              将创建为已完成任务；若未填截止日，会默认用完成日。
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
          任务标签
        </label>
        <GenericTagInput
          selectedTags={values.tags}
          onTagsChange={(tags) => onChange({ tags })}
          placeholder="添加标签..."
        />
      </div>

      <div className="space-y-2.5 relative">
        <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">
          详细描述
        </label>
        <TextareaFormatToolbar
          textareaRef={descRef}
          value={values.description}
          onChange={(description) => onChange({ description })}
        />
        <Textarea
          ref={descRef}
          value={values.description}
          onChange={(e) => {
            onChange({ description: e.target.value });
            setDescCursorPos(e.target.selectionStart || 0);
          }}
          onKeyUp={(e) => setDescCursorPos(e.currentTarget.selectionStart || 0)}
          onClick={(e) => setDescCursorPos(e.currentTarget.selectionStart || 0)}
          placeholder="输入任务描述信息（支持Markdown及@提及）…"
          className="text-xs leading-relaxed min-h-[120px] border-app-border rounded-xl w-full p-3"
        />
        <AiFormatHelper
          value={values.description}
          onChange={(description) => onChange({ description })}
        />
        {descMention && (
          <div className="relative z-50">
            <MentionPicker
              search={descMention.search}
              onSelect={(user) => {
                const newText = replaceMentionText(
                  values.description,
                  descCursorPos,
                  descMention.startIndex,
                  user.username,
                );
                onChange({ description: newText });
                setDescCursorPos(descMention.startIndex + user.username.length + 2);
                descMention.clear();
              }}
              onClose={descMention.clear}
            />
          </div>
        )}
      </div>
    </div>
  );
}
