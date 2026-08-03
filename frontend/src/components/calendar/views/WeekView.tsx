import React, { useMemo } from "react";
import type { CalendarTask } from "../types";
import TimeGrid from "../TimeGrid";
import { weekDaysFrom } from "../dateUtils";

interface WeekViewProps {
  anchorDate: Date;
  tasks: CalendarTask[];
  onTaskClick?: (task: CalendarTask) => void;
  onTaskContextMenu: (e: React.MouseEvent, task: CalendarTask) => void;
  onEmptyClick: (ymd: string, startHm: string, endHm: string) => void;
  onEmptyContextMenu: (e: React.MouseEvent, ymd: string) => void;
  onDayDrop: (e: React.DragEvent, targetYmd: string) => void;
  onTaskDragStart: (e: React.DragEvent, task: CalendarTask, sourceYmd: string) => void;
  onTaskDragEnd: () => void;
  draggingTaskId: string | null;
  dragOverYmd: string | null;
  onDayDragOver: (e: React.DragEvent, ymd: string) => void;
  onDayDragLeave: (e: React.DragEvent, ymd: string) => void;
}

export default function WeekView(props: WeekViewProps) {
  const days = useMemo(() => weekDaysFrom(props.anchorDate), [props.anchorDate]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-x-auto">
      <div className="min-w-[640px] flex flex-col flex-1 min-h-0">
        <TimeGrid
          columns={days.map((d) => ({ date: d }))}
          tasks={props.tasks}
          showColumnHeaders
          onTaskClick={props.onTaskClick}
          onTaskContextMenu={props.onTaskContextMenu}
          onEmptyClick={props.onEmptyClick}
          onEmptyContextMenu={props.onEmptyContextMenu}
          onDayDrop={props.onDayDrop}
          onTaskDragStart={props.onTaskDragStart}
          onTaskDragEnd={props.onTaskDragEnd}
          draggingTaskId={props.draggingTaskId}
          dragOverYmd={props.dragOverYmd}
          onDayDragOver={props.onDayDragOver}
          onDayDragLeave={props.onDayDragLeave}
        />
      </div>
    </div>
  );
}
