import React from "react";
import { Loader2 } from "lucide-react";
import { AppModal } from "@/components/common/AppModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ColorSwatchPicker from "./ColorSwatchPicker";

interface CreateTaskModalProps {
  open: boolean;
  creating: boolean;
  createDate: string;
  createTitle: string;
  createStartTime: string;
  createEndTime: string;
  createProjectId: string;
  createColor: string;
  showProjectFilter?: boolean;
  uniqueProjects: Array<{ id: string; name: string }>;
  defaultProjectId?: string;
  onClose: () => void;
  onSubmit: () => void;
  onTitleChange: (v: string) => void;
  onStartTimeChange: (v: string) => void;
  onEndTimeChange: (v: string) => void;
  onProjectChange: (v: string) => void;
  onColorChange: (v: string) => void;
}

export default function CreateTaskModal({
  open,
  creating,
  createDate,
  createTitle,
  createStartTime,
  createEndTime,
  createProjectId,
  createColor,
  showProjectFilter,
  uniqueProjects,
  defaultProjectId,
  onClose,
  onSubmit,
  onTitleChange,
  onStartTimeChange,
  onEndTimeChange,
  onProjectChange,
  onColorChange,
}: CreateTaskModalProps) {
  if (!open) return null;

  return (
    <AppModal title={`新建任务 · ${createDate}`} onClose={() => !creating && onClose()} widthClass="max-w-sm">
      <div className="space-y-4 p-1">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-tx-secondary">任务标题</label>
          <Input
            autoFocus
            value={createTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="输入任务名称"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        </div>
        {(showProjectFilter || uniqueProjects.length > 1) && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-tx-secondary">所属项目</label>
            <select
              value={createProjectId}
              onChange={(e) => onProjectChange(e.target.value)}
              className="sleek-select w-full h-9 px-2 text-sm rounded-lg border border-app-border bg-app-bg text-tx-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
            >
              {uniqueProjects.length === 0 && defaultProjectId && (
                <option value={defaultProjectId}>当前项目</option>
              )}
              {uniqueProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-tx-secondary">日期</label>
          <p className="text-sm font-mono text-tx-primary">{createDate}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-tx-secondary" htmlFor="cal-create-start">
              开始时间
            </label>
            <Input
              id="cal-create-start"
              type="time"
              value={createStartTime}
              onChange={(e) => onStartTimeChange(e.target.value || "09:00")}
              className="h-9 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-tx-secondary" htmlFor="cal-create-end">
              截止时间
            </label>
            <Input
              id="cal-create-end"
              type="time"
              value={createEndTime}
              onChange={(e) => onEndTimeChange(e.target.value || "10:00")}
              className="h-9 font-mono"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-tx-secondary">卡片颜色</label>
          <ColorSwatchPicker value={createColor} onChange={onColorChange} />
          <p className="text-[10px] text-tx-tertiary">默认蓝色，可点选其他颜色</p>
        </div>
        <p className="text-[11px] text-tx-tertiary">
          当天短时任务 ·{" "}
          <span className="font-mono text-tx-secondary">
            {createDate} {createStartTime || "09:00"}
          </span>
          {" ~ "}
          <span className="font-mono text-tx-secondary">
            {createDate} {createEndTime || "10:00"}
          </span>
          <span className="block mt-1">默认开始前 5 分钟提醒</span>
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" disabled={creating} onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={creating || !createTitle.trim()}
            onClick={onSubmit}
            className="bg-accent-primary text-white hover:bg-accent-primary/95"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : "创建"}
          </Button>
        </div>
      </div>
    </AppModal>
  );
}
