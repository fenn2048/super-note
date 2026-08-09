/**
 * 我的任务 · 矩阵整理面板（对 TaskMatrixView 的薄封装）
 */
import React from "react";
import type { ProjectTask } from "@/types";
import TaskMatrixView, {
  type MatrixBucket,
} from "@/components/TaskMatrixView";

export type MyTasksMatrixPanelProps = {
  tasks: ProjectTask[];
  loading?: boolean;
  onToggleComplete: (taskId: string, currentCompleted: number) => void;
  onStartTask: (task: ProjectTask) => void;
  onPauseTask: (task: ProjectTask) => void;
  onSetQuadrant: (taskIds: string[], target: MatrixBucket) => void;
  onOpenTask?: (taskId: string) => void;
};

export default function MyTasksMatrixPanel({
  tasks,
  loading = false,
  onToggleComplete,
  onStartTask,
  onPauseTask,
  onSetQuadrant,
  onOpenTask,
}: MyTasksMatrixPanelProps) {
  return (
    <TaskMatrixView
      tasks={tasks}
      loading={loading}
      onToggleComplete={onToggleComplete}
      onStartTask={onStartTask}
      onPauseTask={onPauseTask}
      onSetQuadrant={onSetQuadrant}
      onOpenTask={
        onOpenTask ||
        ((id) =>
          window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: id })))
      }
    />
  );
}

export type { MatrixBucket };
