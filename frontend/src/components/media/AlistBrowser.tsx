import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Folder, File, ChevronRight, ArrowLeft, Loader2, CheckSquare, Square, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlistFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
}

interface AlistBrowserProps {
  workspaceId: string | null;
  onImportSuccess: (message: string) => void;
  onClose: () => void;
  collections: Array<{ id: string; title: string; type: "video" | "audio" }>;
}

export default function AlistBrowser({ workspaceId, onImportSuccess, onClose, collections }: AlistBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [files, setFiles] = useState<AlistFile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [importType, setImportType] = useState<"video" | "audio">("video");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [importing, setImporting] = useState<boolean>(false);

  // 1. Fetch directory files on path change
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    
    async function loadDirectory() {
      try {
        const queryParams = new URLSearchParams();
        queryParams.set("path", currentPath);
        if (workspaceId) queryParams.set("workspaceId", workspaceId);
        
        const res = await api.request<{ path: string; files: AlistFile[] }>(
          `/media/alist/list?${queryParams.toString()}`
        );
        if (!active) return;
        
        if (res && res.files) {
          // Sort folders first, then files
          const sorted = [...res.files].sort((a, b) => {
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;
            return a.name.localeCompare(b.name);
          });
          setFiles(sorted);
        } else {
          setError("获取网盘目录失败");
        }
      } catch (err: any) {
        if (!active) return;
        setError(err.message || "连接 Alist 服务失败，请先在系统设置中配置并连接。");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDirectory();
    return () => {
      active = false;
    };
  }, [currentPath, workspaceId]);

  // Handle double clicking folders or clicking link to navigate
  const handleFolderClick = (folderName: string) => {
    const nextPath = currentPath === "/" ? `/${folderName}` : `${currentPath}/${folderName}`;
    setCurrentPath(nextPath);
  };

  const handleGoUp = () => {
    if (currentPath === "/") return;
    const segments = currentPath.split("/");
    segments.pop();
    const parent = segments.join("/") || "/";
    setCurrentPath(parent);
  };

  const toggleSelectFile = (file: AlistFile) => {
    const fullPath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
    const newPaths = new Set(selectedPaths);
    
    if (newPaths.has(fullPath)) {
      newPaths.delete(fullPath);
      setSelectedFiles(selectedFiles.filter(f => f.path !== fullPath));
    } else {
      newPaths.add(fullPath);
      setSelectedFiles([...selectedFiles, { name: file.name, path: fullPath }]);
      
      // Auto-detect audio file to switch import type
      const isAudio = /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.name);
      if (isAudio && importType !== "audio") {
        setImportType("audio");
      }
    }
    setSelectedPaths(newPaths);
  };

  const handleSelectAllInDir = () => {
    const newPaths = new Set(selectedPaths);
    const newFiles = [...selectedFiles];
    
    const onlyFiles = files.filter(f => !f.is_dir);
    const allSelected = onlyFiles.every(f => {
      const fullPath = currentPath === "/" ? `/${f.name}` : `${currentPath}/${f.name}`;
      return newPaths.has(fullPath);
    });

    if (allSelected) {
      // Unselect all in current directory
      onlyFiles.forEach(f => {
        const fullPath = currentPath === "/" ? `/${f.name}` : `${currentPath}/${f.name}`;
        newPaths.delete(fullPath);
      });
      const currentPaths = onlyFiles.map(f => currentPath === "/" ? `/${f.name}` : `${currentPath}/${f.name}`);
      setSelectedFiles(newFiles.filter(f => !currentPaths.includes(f.path)));
    } else {
      // Select all in current directory
      onlyFiles.forEach(f => {
        const fullPath = currentPath === "/" ? `/${f.name}` : `${currentPath}/${f.name}`;
        if (!newPaths.has(fullPath)) {
          newPaths.add(fullPath);
          newFiles.push({ name: f.name, path: fullPath });
        }
      });
      setSelectedFiles(newFiles);
    }
    setSelectedPaths(newPaths);
  };

  // Perform import
  const handleImport = async () => {
    if (selectedFiles.length === 0) return;
    setImporting(true);
    setError("");
    
    try {
      const q = workspaceId ? `?workspaceId=${workspaceId}` : "";
      const res = await api.request<{ success: boolean; message: string }>(`/media/import${q}`, {
        method: "POST",
        body: JSON.stringify({
          collection_id: selectedCollectionId || null,
          workspace_id: workspaceId,
          type: importType,
          files: selectedFiles
        })
      });
      
      if (res && res.success) {
        onImportSuccess(res.message);
      } else {
        setError("导入失败，服务器未返回成功状态");
      }
    } catch (err: any) {
      setError(err.message || "导入过程中出错");
    } finally {
      setImporting(false);
    }
  };

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div
      className="flex flex-col h-full min-h-0 rounded-2xl overflow-hidden border border-app-border"
      style={{ backgroundColor: "var(--color-elevated-solid, #181824)" }}
    >
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 bg-app-sidebar border-b border-app-border flex items-center justify-between shrink-0">
        <div className="min-w-0 pr-2">
          <h3 className="text-base sm:text-lg font-bold text-tx-primary truncate">从 Alist 挂载网盘导入</h3>
          <p className="text-xs text-tx-tertiary">勾选网盘内文件，一键录入本系统</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-tx-tertiary hover:text-tx-primary transition-colors text-sm font-semibold hover:bg-app-hover px-3 py-1.5 rounded-lg shrink-0 min-h-[40px]"
        >
          关闭
        </button>
      </div>

      {/* Main：移动端列布局时，文件列表 flex-1 可滚，导入配置贴底 shrink-0 */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Browser */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col border-b md:border-b-0 md:border-r border-app-border/60 bg-app-sidebar/10">
          {/* Path Navigation & Breadcrumb */}
          <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-app-border/40 flex items-center gap-2 shrink-0 overflow-x-auto no-scrollbar">
            {currentPath !== "/" && (
              <button
                type="button"
                onClick={handleGoUp}
                className="p-1.5 rounded-md hover:bg-app-hover text-tx-secondary hover:text-tx-primary shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <span className="text-xs text-tx-tertiary font-semibold select-none shrink-0">路径:</span>
            <div className="flex items-center text-xs font-mono text-tx-secondary min-w-0">
              <span
                onClick={() => setCurrentPath("/")}
                className="cursor-pointer hover:text-accent-primary hover:underline shrink-0"
              >
                root
              </span>
              {currentPath.split("/").filter(Boolean).map((segment, index, arr) => (
                <React.Fragment key={index}>
                  <ChevronRight size={12} className="mx-1 text-tx-tertiary shrink-0" />
                  <span
                    onClick={() => {
                      const target = "/" + arr.slice(0, index + 1).join("/");
                      setCurrentPath(target);
                    }}
                    className="cursor-pointer hover:text-accent-primary hover:underline truncate max-w-[120px]"
                  >
                    {segment}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/*
            文件列表滚动区：
            - min-h-0 + flex-1：在列 flex 中真正拿到剩余高度
            - overflow-y-auto + overscroll-contain：Android WebView 可滑动且不把滚动传给底层
            - touch-pan-y：明确纵向手势
          */}
          <div
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-1 sm:px-2 touch-pan-y"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {loading ? (
              <div className="h-48 flex flex-col items-center justify-center">
                <Loader2 className="w-8 h-8 text-accent-primary animate-spin mb-2" />
                <span className="text-xs text-tx-secondary">载入目录内容中...</span>
              </div>
            ) : error ? (
              <div className="p-8 text-center">
                <p className="text-sm text-accent-danger font-semibold mb-2">{error}</p>
                <p className="text-xs text-tx-tertiary">请确保 Alist 后台服务运行正常，并在系统设置中连接无误。</p>
              </div>
            ) : files.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-xs text-tx-tertiary">
                当前目录下没有文件或子目录
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-[1]" style={{ backgroundColor: "var(--color-elevated-solid, #181824)" }}>
                  <tr className="border-b border-app-border/30 text-tx-tertiary select-none">
                    <th className="py-2 px-3 w-10 text-center">
                      <button
                        type="button"
                        onClick={handleSelectAllInDir}
                        className="p-1 rounded hover:bg-app-hover"
                      >
                        全选
                      </button>
                    </th>
                    <th className="py-2 px-2">名称</th>
                    <th className="py-2 px-2 w-20 sm:w-24">大小</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file, idx) => {
                    const fullPath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
                    const isSelected = selectedPaths.has(fullPath);
                    return (
                      <tr
                        key={idx}
                        className={cn(
                          "border-b border-app-border/10 hover:bg-app-hover/40 group transition-colors",
                          isSelected ? "bg-accent-primary/5 hover:bg-accent-primary/10" : ""
                        )}
                      >
                        <td className="py-2.5 px-3 text-center">
                          {file.is_dir ? (
                            <div className="w-4 h-4 mx-auto" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleSelectFile(file)}
                              className="p-1.5 rounded text-tx-tertiary hover:text-accent-primary transition-colors"
                            >
                              {isSelected ? (
                                <CheckSquare size={16} className="text-accent-primary" />
                              ) : (
                                <Square size={16} />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="py-2.5 px-2 font-medium">
                          {file.is_dir ? (
                            <button
                              type="button"
                              onClick={() => handleFolderClick(file.name)}
                              className="flex items-center gap-2 text-tx-primary hover:text-accent-primary text-left truncate w-full min-h-[36px]"
                            >
                              <Folder size={16} className="text-amber-500 fill-amber-500/20 shrink-0" />
                              <span className="truncate">{file.name}</span>
                            </button>
                          ) : (
                            <div
                              onClick={() => toggleSelectFile(file)}
                              className="flex items-center gap-2 text-tx-secondary group-hover:text-tx-primary cursor-pointer truncate w-full min-h-[36px]"
                            >
                              <File size={16} className="text-tx-tertiary shrink-0" />
                              <span className="truncate">{file.name}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-tx-tertiary whitespace-nowrap">
                          {file.is_dir ? "目录" : formatBytes(file.size)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right / Bottom: Setup & Action Panel — 移动端固定高度不抢列表滚动区 */}
        <div className="w-full md:w-64 md:max-h-none shrink-0 bg-app-sidebar/30 p-3 sm:p-4 flex flex-col gap-3 border-t md:border-t-0 border-app-border/40">
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-tx-tertiary tracking-wider uppercase">导入配置</h4>

            {/* Media Type Selection */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-tx-secondary font-medium">导入类型</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setImportType("video")}
                  className={cn(
                    "py-2 rounded-lg border text-xs font-semibold transition-all",
                    importType === "video"
                      ? "bg-accent-primary text-white border-accent-primary shadow-sm shadow-accent-primary/20"
                      : "border-app-border bg-app-bg text-tx-secondary hover:bg-app-hover"
                  )}
                >
                  视频 (Movie)
                </button>
                <button
                  type="button"
                  onClick={() => setImportType("audio")}
                  className={cn(
                    "py-2 rounded-lg border text-xs font-semibold transition-all",
                    importType === "audio"
                      ? "bg-accent-primary text-white border-accent-primary shadow-sm shadow-accent-primary/20"
                      : "border-app-border bg-app-bg text-tx-secondary hover:bg-app-hover"
                  )}
                >
                  音乐 (Audio)
                </button>
              </div>
            </div>

            {/* Collection Selection */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-tx-secondary font-medium">关联到合集 (可选)</label>
              <select
                value={selectedCollectionId}
                onChange={(e) => setSelectedCollectionId(e.target.value)}
                className="w-full p-2.5 text-xs bg-app-bg rounded-lg border border-app-border text-tx-primary outline-none focus:border-accent-primary"
              >
                <option value="">不关联到任何合集</option>
                {collections.filter(c => c.type === importType).map(col => (
                  <option key={col.id} value={col.id}>{col.title}</option>
                ))}
              </select>
            </div>

            {/* Selected Count */}
            <div className="p-2.5 sm:p-3 bg-app-bg rounded-xl border border-app-border flex items-center justify-between text-xs">
              <span className="text-tx-tertiary">已选择单品</span>
              <span className="font-bold text-accent-primary text-sm">{selectedFiles.length} 个</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {error && !loading && (
              <p className="text-[10px] text-accent-danger leading-relaxed bg-accent-danger/5 p-2 rounded-lg border border-accent-danger/10">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={handleImport}
              disabled={selectedFiles.length === 0 || importing}
              className={cn(
                "w-full py-3 rounded-xl text-xs font-bold text-white transition-all flex items-center justify-center gap-2 min-h-[44px]",
                selectedFiles.length === 0
                  ? "bg-tx-tertiary/20 text-tx-tertiary cursor-not-allowed"
                  : "bg-accent-primary hover:bg-accent-primary-hover shadow-lg shadow-accent-primary/10 hover:shadow-accent-primary/20 cursor-pointer"
              )}
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  导入中...
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  开始批量录入 ({selectedFiles.length})
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
