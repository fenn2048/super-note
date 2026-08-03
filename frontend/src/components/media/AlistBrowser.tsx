import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Folder, File, ChevronRight, ArrowLeft, Loader2, CheckSquare, Square, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface AlistFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
}

const AUDIO_EXT = /\.(mp3|wav|ogg|flac|aac|m4a|opus|wma)$/i;
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|mpg|mpeg)$/i;

function detectMediaKind(name: string): "audio" | "video" | null {
  if (AUDIO_EXT.test(name)) return "audio";
  if (VIDEO_EXT.test(name)) return "video";
  return null;
}

/** 根据已选文件名多数票推断导入类型 */
function inferImportTypeFromNames(names: string[], fallback: "video" | "audio"): "video" | "audio" {
  let audio = 0;
  let video = 0;
  for (const n of names) {
    const k = detectMediaKind(n);
    if (k === "audio") audio++;
    else if (k === "video") video++;
  }
  if (audio === 0 && video === 0) return fallback;
  if (audio > video) return "audio";
  if (video > audio) return "video";
  return fallback;
}

interface AlistBrowserProps {
  workspaceId: string | null;
  onImportSuccess: (message: string) => void;
  onClose: () => void;
  collections: Array<{ id: string; title: string; type: "video" | "audio" }>;
  /** 打开时默认关联合集（侧栏当前合集） */
  defaultCollectionId?: string | null;
  /** 打开时默认导入类型（当前合集 type 或当前媒体库 tab） */
  defaultImportType?: "video" | "audio";
}

export default function AlistBrowser({
  workspaceId,
  onImportSuccess,
  onClose,
  collections,
  defaultCollectionId = null,
  defaultImportType = "video",
}: AlistBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [files, setFiles] = useState<AlistFile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [importType, setImportType] = useState<"video" | "audio">(defaultImportType);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>(
    defaultCollectionId || "",
  );
  const [importing, setImporting] = useState<boolean>(false);
  /** 各路径滚动位置：进入子目录前记下，返回时恢复 */
  const pathScrollMapRef = useRef<Record<string, number>>({});
  const listScrollRef = useRef<HTMLDivElement>(null);

  // 父级切换默认合集/类型时同步（例如从不同合集再次打开）
  useEffect(() => {
    setImportType(defaultImportType);
    const id = defaultCollectionId || "";
    if (id) {
      const col = collections.find((c) => c.id === id);
      if (col && col.type === defaultImportType) {
        setSelectedCollectionId(id);
        return;
      }
    }
    setSelectedCollectionId((prev) => {
      if (!prev) return "";
      const col = collections.find((c) => c.id === prev);
      return col && col.type === defaultImportType ? prev : "";
    });
  }, [defaultCollectionId, defaultImportType, collections]);

  const rememberScroll = (path: string) => {
    const el = listScrollRef.current;
    if (el) pathScrollMapRef.current[path] = el.scrollTop;
  };

  const navigateToPath = (nextPath: string) => {
    rememberScroll(currentPath);
    setCurrentPath(nextPath);
  };

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
    navigateToPath(nextPath);
  };

  const handleGoUp = () => {
    if (currentPath === "/") return;
    const segments = currentPath.split("/");
    segments.pop();
    const parent = segments.join("/") || "/";
    navigateToPath(parent);
  };

  const applyTypeFromSelection = (fileList: Array<{ name: string; path: string }>) => {
    const nextType = inferImportTypeFromNames(
      fileList.map((f) => f.name),
      defaultImportType,
    );
    setImportType(nextType);
    // 类型变化时，若当前合集类型不符则回退到默认合集（同 type）或清空
    setSelectedCollectionId((prev) => {
      const prefer = defaultCollectionId || prev;
      if (prefer) {
        const col = collections.find((c) => c.id === prefer);
        if (col && col.type === nextType) return prefer;
      }
      if (prev) {
        const col = collections.find((c) => c.id === prev);
        if (col && col.type === nextType) return prev;
      }
      return "";
    });
  };

  const toggleSelectFile = (file: AlistFile) => {
    const fullPath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
    const newPaths = new Set(selectedPaths);
    let nextFiles: Array<{ name: string; path: string }>;

    if (newPaths.has(fullPath)) {
      newPaths.delete(fullPath);
      nextFiles = selectedFiles.filter((f) => f.path !== fullPath);
    } else {
      newPaths.add(fullPath);
      nextFiles = [...selectedFiles, { name: file.name, path: fullPath }];
    }
    setSelectedPaths(newPaths);
    setSelectedFiles(nextFiles);
    if (nextFiles.length > 0) applyTypeFromSelection(nextFiles);
  };

  const handleSelectAllInDir = () => {
    const newPaths = new Set(selectedPaths);
    let newFiles = [...selectedFiles];
    
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
      newFiles = newFiles.filter(f => !currentPaths.includes(f.path));
    } else {
      // Select all in current directory
      onlyFiles.forEach(f => {
        const fullPath = currentPath === "/" ? `/${f.name}` : `${currentPath}/${f.name}`;
        if (!newPaths.has(fullPath)) {
          newPaths.add(fullPath);
          newFiles.push({ name: f.name, path: fullPath });
        }
      });
    }
    setSelectedPaths(newPaths);
    setSelectedFiles(newFiles);
    if (newFiles.length > 0) applyTypeFromSelection(newFiles);
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

  // 列表加载完成后恢复该路径的滚动位置（首次进入为 0）
  useEffect(() => {
    if (loading) return;
    const el = listScrollRef.current;
    if (!el) return;
    const y = pathScrollMapRef.current[currentPath] ?? 0;
    // 等 DOM 绘制完再恢复，避免内容高度为 0 时 scrollTop 无效
    requestAnimationFrame(() => {
      el.scrollTop = y;
    });
  }, [currentPath, loading, files]);

  return (
    <div
      className="flex flex-col h-full min-h-0 rounded-2xl overflow-hidden border border-app-border"
      style={{
        backgroundColor: "var(--color-elevated-solid, #181824)",
        // 明确高度继承父级 94dvh，防止子项按内容撑开
        height: "100%",
        maxHeight: "100%",
      }}
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

      {/* Main：列布局；列表区用 relative + absolute 强制可滚（Android WebView 可靠） */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Browser */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col border-b md:border-b-0 md:border-r border-app-border/60 bg-app-sidebar/10 overflow-hidden">
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
                onClick={() => navigateToPath("/")}
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
                      navigateToPath(target);
                    }}
                    className="cursor-pointer hover:text-accent-primary hover:underline truncate max-w-[120px]"
                  >
                    {segment}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* 列表头（不随内容滚，固定在滚动区上方） */}
          <div
            className="shrink-0 flex items-center gap-1 px-2 sm:px-3 py-2 border-b border-app-border/30 text-xs text-tx-tertiary select-none"
            style={{ backgroundColor: "var(--color-elevated-solid, #181824)" }}
          >
            <button
              type="button"
              onClick={handleSelectAllInDir}
              className="w-10 shrink-0 p-1 rounded hover:bg-app-hover text-center"
            >
              全选
            </button>
            <span className="flex-1 min-w-0 px-1">名称</span>
            <span className="w-16 sm:w-20 shrink-0 text-right pr-1">大小</span>
          </div>

          {/*
            关键滚动层：
            - 外层 relative flex-1 min-h-0
            - 内层 absolute inset-0 + overflow-y: scroll（不用 auto）
            - 列表用 div 不用 table，避免部分 WebView 表格滚动手势失效
          */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={listScrollRef}
              className="absolute inset-0 overflow-y-scroll overflow-x-hidden overscroll-y-contain px-1 sm:px-2"
              style={{
                WebkitOverflowScrolling: "touch",
                touchAction: "pan-y",
                overscrollBehavior: "contain",
              }}
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
                <ul className="list-none m-0 p-0 pb-4">
                  {files.map((file, idx) => {
                    const fullPath = currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
                    const isSelected = selectedPaths.has(fullPath);
                    return (
                      <li
                        key={`${fullPath}-${idx}`}
                        className={cn(
                          "flex items-center gap-1 border-b border-app-border/10 text-xs",
                          isSelected ? "bg-accent-primary/5" : "active:bg-app-hover/40",
                        )}
                      >
                        <div className="w-10 shrink-0 flex items-center justify-center py-2">
                          {file.is_dir ? (
                            <div className="w-4 h-4" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleSelectFile(file)}
                              className="p-2 rounded text-tx-tertiary active:text-accent-primary"
                              aria-label={isSelected ? "取消选择" : "选择"}
                            >
                              {isSelected ? (
                                <CheckSquare size={16} className="text-accent-primary" />
                              ) : (
                                <Square size={16} />
                              )}
                            </button>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 py-2 pr-1">
                          {file.is_dir ? (
                            <button
                              type="button"
                              onClick={() => handleFolderClick(file.name)}
                              className="flex items-center gap-2 text-tx-primary text-left truncate w-full min-h-[40px]"
                            >
                              <Folder size={16} className="text-amber-500 fill-amber-500/20 shrink-0" />
                              <span className="truncate font-medium">{file.name}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleSelectFile(file)}
                              className="flex items-center gap-2 text-tx-secondary text-left truncate w-full min-h-[40px]"
                            >
                              <File size={16} className="text-tx-tertiary shrink-0" />
                              <span className="truncate font-medium">{file.name}</span>
                            </button>
                          )}
                        </div>
                        <div className="w-16 sm:w-20 shrink-0 text-right text-tx-tertiary py-2 pr-2 whitespace-nowrap">
                          {file.is_dir ? "目录" : formatBytes(file.size)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Right / Bottom: Setup & Action Panel — 移动端 shrink-0，不参与列表高度计算 */}
        <div className="w-full md:w-64 shrink-0 bg-app-sidebar/30 p-3 sm:p-4 flex flex-col gap-3 border-t md:border-t-0 border-app-border/40 max-h-[42%] md:max-h-none overflow-y-auto">
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
                    "py-2 rounded-lg border text-xs font-semibold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out",
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
                    "py-2 rounded-lg border text-xs font-semibold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out",
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
                "w-full py-3 rounded-xl text-xs font-bold text-white transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out flex items-center justify-center gap-2 min-h-[44px]",
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
