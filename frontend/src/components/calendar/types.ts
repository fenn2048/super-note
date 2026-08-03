import type { ProjectStage, ProjectTask } from "@/types";

export type CalendarViewMode = "day" | "week" | "month" | "year";

export const CALENDAR_VIEW_STORAGE_KEY = "super-calendar-view";

export interface ProjectCalendarProps {
  stages: ProjectStage[];
  onTaskClick?: (task: ProjectTask) => void;
  showProjectFilter?: boolean;
  onRefresh?: () => void;
  defaultProjectId?: string;
  projects?: Array<{ id: string; name: string }>;
}

export interface CalendarTask extends ProjectTask {
  stageName?: string;
  projectName?: string;
}

export type TaskClipboard = {
  mode: "copy" | "cut";
  title: string;
  description: string;
  projectId: string;
  priority: number;
  startTime?: string | null;
  endTime?: string | null;
  isRecurring?: number;
  recurrenceRule?: string | null;
  reminderOffsetValue?: number;
  reminderOffsetUnit?: ProjectTask["reminderOffsetUnit"];
  titleColor?: string | null;
  tags?: string[];
  participants?: string[];
};

export const CAL_TASK_DRAG_MIME = "application/x-supernote-cal-task";

export const HOUR_ROW_PX = 48;
export const GRID_START_HOUR = 0;
export const GRID_END_HOUR = 24;
