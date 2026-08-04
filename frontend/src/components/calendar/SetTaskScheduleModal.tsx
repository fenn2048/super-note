/**
 * 右键「设置时间」：精确到分钟的开始 / 截止时间
 * 例：2026-09-10 09:00
 */
import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AppModal } from "@/components/common/AppModal";
import { Button } from "@/components/ui/button";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import { cn } from "@/lib/utils";
import {
  combineDateTime,
  defaultSlotForYmd,
  extractTimeHm,
  taskDateOnly,
  toLocalYmd,
} from "./dateUtils";
import type { CalendarTask } from "./types";

export type ScheduleSavePayload = {
  startDate: string;
  endDate: string;
};

interface SetTaskScheduleModalProps {
  open: boolean;
  task: CalendarTask | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (payload: ScheduleSavePayload) => void;
}

function fieldToPickerValue(field: string | null | undefined, fallbackYmd: string, fallbackHm: string): string {
  const ymd = taskDateOnly(field) || fallbackYmd;
  const hm = extractTimeHm(field) || fallbackHm;
  return combineDateTime(ymd, hm);
}

export default function SetTaskScheduleModal({
  open,
  task,
  saving = false,
  onClose,
  onSave,
}: SetTaskScheduleModalProps) {
  const today = toLocalYmd(new Date());
  const slot = defaultSlotForYmd(today);
  const [startVal, setStartVal] = useState(`${today} ${slot.start}`);
  const [endVal, setEndVal] = useState(`${today} ${slot.end}`);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    const ymd =
      taskDateOnly(task.startDate) ||
      taskDateOnly(task.endDate) ||
      today;
    const def = defaultSlotForYmd(ymd);
    setStartVal(fieldToPickerValue(task.startDate, ymd, def.start));
    setEndVal(fieldToPickerValue(task.endDate, ymd, def.end));
    setError(null);
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !task) return null;

  const handleSave = () => {
    const start = startVal.trim();
    const end = endVal.trim();
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(end)) {
      setError("请选择完整的日期与时间（精确到分钟）");
      return;
    }
    if (end < start) {
      setError("截止时间不能早于开始时间");
      return;
    }
    setError(null);
    onSave({ startDate: start, endDate: end });
  };

  return (
    <AppModal
      title="设置任务时间"
      onClose={() => !saving && onClose()}
      widthClass="max-w-md"
    >
      <div className="space-y-4 p-1">
        <p className="text-xs text-tx-tertiary truncate">
          <span className="font-semibold text-tx-secondary">{task.title}</span>
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-tx-secondary">开始时间</label>
          <SleekDatePicker
            value={startVal}
            onChange={setStartVal}
            showTime
            placeholder="选择开始日期与时间"
            className="w-full"
          />
          <p className="text-[10px] font-mono text-tx-tertiary">{startVal || "—"}</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-tx-secondary">截止时间</label>
          <SleekDatePicker
            value={endVal}
            onChange={setEndVal}
            showTime
            placeholder="选择截止日期与时间"
            className="w-full"
          />
          <p className="text-[10px] font-mono text-tx-tertiary">{endVal || "—"}</p>
        </div>

        {error && (
          <p className="text-xs text-red-500 font-medium" role="alert">
            {error}
          </p>
        )}

        <p className="text-[11px] text-tx-tertiary leading-relaxed">
          精确到分钟，例如{" "}
          <span className="font-mono text-tx-secondary">2026-09-10 09:00</span>
          。拖拽任务卡片也可在日/周视图中改时间。
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={handleSave}
            className={cn(saving && "opacity-80")}
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1.5" />
                保存中
              </>
            ) : (
              "保存"
            )}
          </Button>
        </div>
      </div>
    </AppModal>
  );
}
