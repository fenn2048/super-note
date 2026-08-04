import React from "react";
import { Lunar } from "lunar-javascript";
import type { CalendarTask } from "../types";
import TimeGrid, { type DayDropPayload, type TaskTimeChangePayload } from "../TimeGrid";
import { toLocalYmd } from "../dateUtils";

interface DayViewProps {
  anchorDate: Date;
  tasks: CalendarTask[];
  onTaskClick?: (task: CalendarTask) => void;
  onTaskContextMenu: (e: React.MouseEvent, task: CalendarTask) => void;
  onEmptyClick: (ymd: string, startHm: string, endHm: string) => void;
  onEmptyContextMenu: (e: React.MouseEvent, ymd: string) => void;
  onDayDrop: (e: React.DragEvent, payload: DayDropPayload) => void;
  onTaskDragStart: (e: React.DragEvent, task: CalendarTask, sourceYmd: string) => void;
  onTaskDragEnd: () => void;
  onTaskTimeChange?: (payload: TaskTimeChangePayload) => void;
  draggingTaskId: string | null;
  dragOverYmd: string | null;
  onDayDragOver: (e: React.DragEvent, ymd: string) => void;
  onDayDragLeave: (e: React.DragEvent, ymd: string) => void;
}

export default function DayView(props: DayViewProps) {
  const lunar = Lunar.fromDate(props.anchorDate);
  const lunarLabel = `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
  const weekNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 py-2 border-b border-app-border/50 shrink-0 flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-tx-primary">
            {props.anchorDate.getFullYear()}年{props.anchorDate.getMonth() + 1}月
            {props.anchorDate.getDate()}日
          </div>
          <div className="text-[11px] text-tx-tertiary font-semibold">
            {weekNames[props.anchorDate.getDay()]} · {lunarLabel}
          </div>
        </div>
        <div className="text-[10px] text-tx-tertiary font-mono">{toLocalYmd(props.anchorDate)}</div>
      </div>
      <TimeGrid
        columns={[{ date: props.anchorDate }]}
        tasks={props.tasks}
        showColumnHeaders={false}
        onTaskClick={props.onTaskClick}
        onTaskContextMenu={props.onTaskContextMenu}
        onEmptyClick={props.onEmptyClick}
        onEmptyContextMenu={props.onEmptyContextMenu}
        onDayDrop={props.onDayDrop}
        onTaskDragStart={props.onTaskDragStart}
        onTaskDragEnd={props.onTaskDragEnd}
        onTaskTimeChange={props.onTaskTimeChange}
        draggingTaskId={props.draggingTaskId}
        dragOverYmd={props.dragOverYmd}
        onDayDragOver={props.onDayDragOver}
        onDayDragLeave={props.onDayDragLeave}
      />
    </div>
  );
}
