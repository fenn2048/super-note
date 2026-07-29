import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileUp,
  Upload,
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
  Sparkles,
  BookOpen,
  Inbox,
  FileAudio,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { importMemos, ImportProgress } from "@/lib/importService";
import { toast } from "@/lib/toast";
import { getCurrentWorkspace, setCurrentWorkspace } from "@/lib/api";

export interface MemosImportProps {
  workspaceId?: string;
  onImportComplete?: () => void;
}

/** 把 DataManager 的 workspaceId（personal / uuid / 空）归一成侧边栏用的 currentWorkspace 值 */
function normalizeImportScope(workspaceId?: string): { isPersonal: boolean; scopeKey: string; label: string } {
  if (!workspaceId || workspaceId === "" || workspaceId === "personal") {
    return { isPersonal: true, scopeKey: "", label: "个人空间" };
  }
  return { isPersonal: false, scopeKey: workspaceId, label: "当前工作区" };
}

export function MemosImport({ workspaceId, onImportComplete }: MemosImportProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [targetType, setTargetType] = useState<"diaries" | "notes">("diaries");
  const [isDragOver, setIsDragOver] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [showFailedList, setShowFailedList] = useState(true);
  const [showTranscribingList, setShowTranscribingList] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      const selectedFile = droppedFiles[0];
      const lower = selectedFile.name.toLowerCase();
      if (lower.endsWith(".json") || lower.endsWith(".zip")) {
        setFile(selectedFile);
        setProgress(null);
      } else {
        toast.error("只支持 Memos 导出的 .json 或 .zip 备份文件");
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      const selectedFile = selectedFiles[0];
      const lower = selectedFile.name.toLowerCase();
      if (lower.endsWith(".json") || lower.endsWith(".zip")) {
        setFile(selectedFile);
        setProgress(null);
      } else {
        toast.error("只支持 Memos 导出的 .json 或 .zip 备份文件");
      }
    }
    e.target.value = "";
  };

  const handleStartImport = async () => {
    if (!file) return;
    try {
      const scope = normalizeImportScope(workspaceId);
      const res = await importMemos(
        file,
        targetType,
        (p) => setProgress(p),
        { workspaceId }
      );
      if (res.success) {
        const kind = targetType === "diaries" ? "说说" : "笔记";
        // 侧边栏 currentWorkspace：'' = 个人空间；uuid = 工作区
        // 若导入到个人空间而侧边栏在工作区，时间线按 workspaceId 过滤会「看不到」数据
        const currentWs = getCurrentWorkspace() || "";
        const currentNorm = currentWs === "personal" ? "" : currentWs;
        const viewingMismatch = currentNorm !== scope.scopeKey;

        if (targetType === "diaries") {
          window.dispatchEvent(
            new CustomEvent("super:diaries-imported", {
              detail: {
                count: res.count,
                workspaceId: scope.isPersonal ? "personal" : scope.scopeKey,
              },
            })
          );
        }

        if (viewingMismatch && res.count > 0) {
          toast.success(
            `已导入 ${res.count} 条${kind}到「${scope.label}」。侧边栏不在该空间，正在切换…`,
            5500
          );
          setCurrentWorkspace(scope.scopeKey);
          window.dispatchEvent(
            new CustomEvent("super:workspace-changed", {
              detail: { workspaceId: scope.scopeKey },
            })
          );
          window.dispatchEvent(new CustomEvent("super:close-settings"));
        } else {
          toast.success(`成功导入了 ${res.count} 条${kind}到「${scope.label}」！可到${kind === "说说" ? "说说时间线" : "Memos 笔记本"}查看`);
          if (targetType === "diaries") {
            // 同空间也强制刷新时间线
            window.dispatchEvent(new CustomEvent("super:diaries-imported"));
          }
        }
        onImportComplete?.();
      }
    } catch (err: any) {
      setProgress({
        phase: "error",
        current: 0,
        total: 0,
        message: err?.message || "导入失败",
        failedItems: [{ name: file.name, reason: err?.message || "导入失败" }],
      });
      toast.error(err?.message || "导入发生错误");
    }
  };

  const handleCancel = () => {
    setFile(null);
    setProgress(null);
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 mt-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Inbox size={18} />
        </div>
        <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Memos 数据导入
        </h5>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5 leading-relaxed">
        支持从 Memos 导出的{" "}
        <code className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-zinc-100 dark:bg-zinc-850 text-zinc-800 dark:text-zinc-200 border border-zinc-200/50 dark:border-zinc-700/50">
          .json
        </code>{" "}
        数据文件，或者包含图片和语音资源附件的{" "}
        <code className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-zinc-100 dark:bg-zinc-855 text-zinc-800 dark:text-zinc-200 border border-zinc-200/50 dark:border-zinc-700/50">
          .zip
        </code>{" "}
        备份文件。
        <span className="block mt-1.5 text-zinc-600 dark:text-zinc-300">
          导入目标 = 数据管理顶部当前 Tab：
          <strong>个人空间</strong> 或 <strong>工作区（需选中具体工作区）</strong>
          。在侧边栏打开设置不会自动带入工作区，请确认顶部已选对。
        </span>
      </p>

      {!file ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border border-dashed rounded-lg p-10 text-center transition-all cursor-pointer ${
            isDragOver
              ? "border-blue-500 bg-blue-50/30 dark:bg-blue-500/5"
              : "border-zinc-300 dark:border-zinc-850 hover:border-blue-400 dark:hover:border-zinc-600 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zip"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Upload
            size={36}
            className={`mx-auto mb-3 transition-transform duration-300 ${
              isDragOver ? "text-blue-500 scale-110" : "text-zinc-400 dark:text-zinc-500"
            }`}
          />
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            拖拽 Memos 备份文件到这里，或 <span className="text-blue-500 hover:text-blue-600 font-semibold">点击上传</span>
          </p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2">
            支持 .json 数据包 或带有附件的 .zip 压缩文件
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-zinc-100 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-800/20 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-md bg-blue-500/10 text-blue-500 shrink-0">
                <FileUp size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[200px] sm:max-w-[360px]">
                  {file.name}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 font-mono mt-0.5">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            {!progress && (
              <button
                onClick={handleCancel}
                className="p-1.5 rounded-md text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="重新选择"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {!progress ? (
            <div className="space-y-5">
              <div>
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2.5 block">
                  导入目标类型
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setTargetType("diaries")}
                    className={`flex flex-col items-center p-4 rounded-lg border text-center transition-all ${
                      targetType === "diaries"
                        ? "border-blue-500 bg-blue-500/[0.03] dark:bg-blue-500/[0.05] text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                    }`}
                  >
                    <Sparkles size={20} className="mb-2 text-blue-500" />
                    <span className="text-xs font-bold">导入为说说 (推荐)</span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1.5 leading-normal max-w-[200px]">
                      保留说说时间轴、图片附件与可见性控制，最贴近 Memos 原生体验
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetType("notes")}
                    className={`flex flex-col items-center p-4 rounded-lg border text-center transition-all ${
                      targetType === "notes"
                        ? "border-blue-500 bg-blue-500/[0.03] dark:bg-blue-500/[0.05] text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                    }`}
                  >
                    <BookOpen size={20} className="mb-2 text-blue-500" />
                    <span className="text-xs font-bold">导入为笔记</span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1.5 leading-normal max-w-[200px]">
                      自动创建 "Memos" 笔记本，并将说说转换为独立的富文本笔记
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-700"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleStartImport}
                  className="px-4 py-2 rounded-md text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 active:scale-[0.98] transition-all shadow-sm"
                >
                  开始导入
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  {progress.phase === "reading" && "正在解析文件"}
                  {progress.phase === "uploading" && "正在导入中..."}
                  {progress.phase === "done" && "导入完成"}
                  {progress.phase === "error" && "导入失败"}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                  {progress.phase === "uploading" && `${progress.current} / ${progress.total}`}
                  {progress.phase === "done" && `共导入 ${progress.current} 条`}
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-zinc-150 dark:bg-zinc-800 overflow-hidden relative">
                <motion.div
                  className={`h-full rounded-full transition-all ${
                    progress.phase === "error"
                      ? "bg-red-500"
                      : progress.phase === "done"
                      ? "bg-emerald-500"
                      : "bg-blue-500"
                  }`}
                  initial={{ width: 0 }}
                  animate={{
                    width:
                      progress.phase === "done"
                        ? "100%"
                        : progress.phase === "reading"
                        ? "10%"
                        : `${(progress.current / Math.max(progress.total, 1)) * 100}%`,
                  }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              <div className="flex items-center gap-2 text-xs">
                {progress.phase === "uploading" || progress.phase === "reading" ? (
                  <Loader2 size={14} className="animate-spin text-blue-500 shrink-0" />
                ) : progress.phase === "done" ? (
                  <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                )}
                <span
                  className={`truncate font-medium max-w-[90%] ${
                    progress.phase === "error"
                      ? "text-red-500"
                      : progress.phase === "done"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  {progress.message}
                </span>
              </div>

              {/* 语音转写进度列表 */}
              {progress.transcribingItems && progress.transcribingItems.length > 0 && (
                <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowTranscribingList(!showTranscribingList)}
                    className="w-full px-3 py-2 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/40 text-xs font-semibold text-zinc-700 dark:text-zinc-300 border-b border-zinc-100 dark:border-zinc-800"
                  >
                    <div className="flex items-center gap-1.5">
                      <FileAudio size={14} className="text-blue-500" />
                      <span>语音附件转写 ({progress.transcribingItems.filter((i) => i.status === "success").length} / {progress.transcribingItems.length})</span>
                    </div>
                    {showTranscribingList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <AnimatePresence initial={false}>
                    {showTranscribingList && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        className="overflow-hidden bg-white dark:bg-zinc-900 max-h-[160px] overflow-y-auto"
                      >
                        <div className="p-2 space-y-1.5">
                          {progress.transcribingItems.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-xs px-2 py-1 rounded bg-zinc-50/50 dark:bg-zinc-800/10"
                            >
                              <span className="truncate text-zinc-600 dark:text-zinc-400 max-w-[200px]" title={item.name}>
                                {item.name}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                {item.status === "transcribing" && (
                                  <>
                                    <Loader2 size={12} className="animate-spin text-blue-500" />
                                    <span className="text-[10px] text-blue-500 font-medium">正在转写</span>
                                  </>
                                )}
                                {item.status === "success" && (
                                  <>
                                    <CheckCircle size={12} className="text-emerald-500" />
                                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">成功</span>
                                  </>
                                )}
                                {item.status === "failed" && (
                                  <>
                                    <X size={12} className="text-red-500" />
                                    <span className="text-[10px] text-red-500 font-medium">失败</span>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* 失败项目列表 */}
              {progress.failedItems && progress.failedItems.length > 0 && (
                <div className="border border-red-150 dark:border-red-900/30 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowFailedList(!showFailedList)}
                    className="w-full px-3 py-2 flex items-center justify-between bg-red-50/50 dark:bg-red-950/10 text-xs font-semibold text-red-700 dark:text-red-400 border-b border-red-100 dark:border-red-900/30"
                  >
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={14} />
                      <span>导入失败项目 ({progress.failedItems.length})</span>
                    </div>
                    {showFailedList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <AnimatePresence initial={false}>
                    {showFailedList && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        className="overflow-hidden bg-white dark:bg-zinc-900 max-h-[160px] overflow-y-auto"
                      >
                        <div className="p-2 space-y-1.5">
                          {progress.failedItems.map((item, idx) => (
                            <div
                              key={idx}
                              className="text-xs p-2 rounded bg-red-50/20 dark:bg-red-950/5 border border-red-50 dark:border-red-950/20"
                            >
                              <div className="font-semibold text-zinc-800 dark:text-zinc-200 truncate" title={item.name}>
                                {item.name}
                              </div>
                              <div className="text-[10px] text-red-500 mt-1 leading-relaxed">
                                失败原因: {item.reason}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {(progress.phase === "done" || progress.phase === "error") && (
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-4 py-2 rounded-md text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-700"
                  >
                    确定并返回
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
