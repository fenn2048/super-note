import React, { useState, useEffect, useRef } from "react";
import { api, getServerUrl, resolveAttachmentUrl } from "@/lib/api";
import { Book, BookGroup } from "@/types";
import { cn } from "@/lib/utils";
import { readBooks, readBookGroups } from "@/lib/offlineRead";
import {
  BookOpen,
  FolderPlus,
  Trash2,
  Edit,
  Search,
  Upload,
  Folder,
  ChevronRight,
  MoreVertical,
  Globe,
  Lock,
  Loader2,
  X,
  Menu,
  FileText,
  User,
  Tags,
  Share2,
  Plus,
} from "lucide-react";
import {
  EmptyState,
  EmptyActionButton,
  LoadingBlock,
} from "@/components/common/FeedbackStates";
import {
  collectBookFilesFromDataTransfer,
  epubPackageAccessHint,
} from "@/lib/epubPackage";
import ReadingDashboard, {
  BOOK_COVER_WIDTH_CLASS,
} from "@/components/books/ReadingDashboard";

interface BookCenterProps {
  onOpenBook: (bookHash: string) => void;
  workspaceId: string | null;
}

export default function BookCenter({ onOpenBook, workspaceId }: BookCenterProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [groups, setGroups] = useState<BookGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  // 默认进入「阅读中」仪表盘（桌面 / 移动同一套 UI）
  const [selectedFilter, setSelectedFilter] = useState<string>("reading"); // "all", "uncategorized", "reading", "finished", or groupId
  const [newGroupName, setNewGroupName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Edit Modal State
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editGroupId, setEditGroupId] = useState<string>("");
  const [editVisibility, setEditVisibility] = useState<"PRIVATE" | "WORKSPACE">("PRIVATE");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, [workspaceId, selectedFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch groups
      const fetchedGroups = await readBookGroups(() => api.books.getGroups());
      setGroups(fetchedGroups);

      // 2. Build list params
      const params: { groupId?: string; q?: string } = {};
      if (selectedFilter !== "all" && selectedFilter !== "uncategorized" && selectedFilter !== "reading" && selectedFilter !== "finished") {
        params.groupId = selectedFilter;
      } else if (selectedFilter === "uncategorized") {
        params.groupId = "uncategorized";
      }

      // 3. Fetch books
      let fetchedBooks = await readBooks(() => api.books.list(params));

      // 4. Apply status filtering in frontend if needed
      if (selectedFilter === "reading") {
        fetchedBooks = fetchedBooks.filter(b => b.readingStatus === "reading");
      } else if (selectedFilter === "finished") {
        fetchedBooks = fetchedBooks.filter(b => b.readingStatus === "finished");
      }

      setBooks(fetchedBooks);
    } catch (err) {
      console.error("加载书库失败:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    try {
      await api.books.createGroup(newGroupName.trim());
      setNewGroupName("");
      const fetchedGroups = await api.books.getGroups();
      setGroups(fetchedGroups);
    } catch (err) {
      console.error("新建分类失败:", err);
      alert("新建分类失败");
    }
  };

  const handleDeleteGroup = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个分类吗？分类下的书籍将变为未分类。")) return;
    try {
      await api.books.deleteGroup(id);
      if (selectedFilter === id) {
        setSelectedFilter("reading");
      }
      fetchData();
    } catch (err) {
      console.error("删除分类失败:", err);
      alert("删除分类失败");
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const stringifyMetadataField = (field: any): string => {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (Array.isArray(field)) {
      return field.map(x => stringifyMetadataField(x)).filter(Boolean).join(", ");
    }
    if (typeof field === "object") {
      return field.name || field.value || field.text || JSON.stringify(field);
    }
    return String(field);
  };

  /**
   * 立刻把 File 读进内存，避免：
   * 1) 拖放后的 File 在 drop 事件结束 / 后续 await 后失效（NotFoundError）
   * 2) FormData 上传时浏览器读不到磁盘路径（net::ERR_ACCESS_DENIED / Failed to fetch）
   * 3) iCloud/网盘占位文件“可见但未本地下载”
   */
  const materializeFile = async (file: File): Promise<File> => {
    const looksEpub = /\.epub$/i.test(file.name);
    try {
      // 解包 epub 目录被当成 File 时 size 常为 0 或不可读
      if (looksEpub && file.size === 0) {
        throw new Error(epubPackageAccessHint(file.name));
      }
      const buffer = await file.arrayBuffer();
      if (buffer.byteLength === 0) {
        throw new Error(
          looksEpub
            ? epubPackageAccessHint(file.name)
            : `无法读取「${file.name}」内容（可能是云端占位文件，请先在本地下载完整文件后再导入）`
        );
      }
      // ZIP 魔数 PK\x03\x04；解包目录不会通过这里（通常读失败），若读到非 zip 的“假 epub”再提示
      if (looksEpub) {
        const u8 = new Uint8Array(buffer.slice(0, 4));
        const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
        if (!isZip) {
          throw new Error(
            `「${file.name}」不是标准 epub 压缩包（内容不是 ZIP）。` +
              `若来自 Apple Books 的解包目录，请把文件夹拖进导入区自动打包，或先 zip 成真正的 .epub。`
          );
        }
      }
      return new File([buffer], file.name, {
        type: file.type || (looksEpub ? "application/epub+zip" : "application/octet-stream"),
        lastModified: file.lastModified,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Apple Books")) throw err;
      const name = (err as DOMException)?.name;
      if (name === "NotFoundError" || name === "NotAllowedError" || name === "SecurityError") {
        throw new Error(
          looksEpub
            ? epubPackageAccessHint(file.name)
            : `无法访问文件「${file.name}」。请确认文件仍在本地（iCloud/网盘需先下载完成），或改用「选择文件」按钮导入。`
        );
      }
      throw err;
    }
  };

  const formatImportError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/413|entity too large|Request Entity Too Large|BOOK_TOO_LARGE|过大/i.test(msg)) {
      return (
        "上传被拒绝（413 文件过大）。400MB+ 的 PDF 需要：\n" +
        "1) 反代 nginx 设置 client_max_body_size 512m;（或更大）\n" +
        "2) 后端环境变量 MAX_BOOK_UPLOAD_MB（默认 512）\n" +
        "详情: " +
        msg
      );
    }
    if (
      msg === "Failed to fetch" ||
      msg.includes("NetworkError") ||
      msg.includes("Load failed")
    ) {
      return (
        "网络请求失败（Failed to fetch）。常见原因：1) 文件读取权限丢失，请改用「选择文件」或确认云盘文件已本地下载；" +
        "2) 后端未启动或代理异常；3) 大文件被反代截断。原始错误: " +
        msg
      );
    }
    return msg;
  };

  /** 超过该体积不再整文件物化到内存（避免 400MB PDF 双倍占用）；也不再强解封面 */
  const LARGE_BOOK_BYTES = 80 * 1024 * 1024;

  const processAndImportBook = async (
    file: File,
    opts: { alreadyMaterialized?: boolean; manageUploading?: boolean } = {}
  ) => {
    const { alreadyMaterialized = false, manageUploading = true } = opts;
    const ext = file.name.split(".").pop()?.toLowerCase();
    const allowed = ["epub", "pdf", "mobi", "azw", "azw3", "cbz", "fb2"];
    if (!ext || !allowed.includes(ext)) {
      alert(`不支持的文件格式 "${file.name}"。仅支持: ${allowed.join(", ")}`);
      return;
    }

    if (manageUploading) setIsUploading(true);
    try {
      // 小文件：立刻读入内存，避免拖放句柄失效。
      // 大文件：整本 materialize 会 OOM，仅探测可读后直接上传原 File。
      let localFile: File;
      if (alreadyMaterialized) {
        localFile = file;
      } else if (file.size > LARGE_BOOK_BYTES) {
        try {
          const head = await file.slice(0, 8).arrayBuffer();
          if (!head.byteLength) {
            throw new Error(`无法读取「${file.name}」（文件可能不可访问）`);
          }
        } catch (err) {
          const name = (err as DOMException)?.name;
          if (name === "NotFoundError" || name === "NotAllowedError") {
            throw new Error(epubPackageAccessHint(file.name));
          }
          throw err;
        }
        localFile = file;
      } else {
        localFile = await materializeFile(file);
      }

      let coverBlob: Blob | null = null;
      let parsedTitle: string | undefined;
      let parsedAuthor: string | undefined;

      // 超大 PDF 解析封面/元数据很慢且易失败（worker MIME 等），导入时跳过，书名用文件名
      const skipMeta = localFile.size > LARGE_BOOK_BYTES && ext === "pdf";
      if (!skipMeta) {
        try {
          const { DocumentLoader } = await import("@/lib/bookDocument");
          const loader = new DocumentLoader(localFile);
          const { book: bookDoc } = await loader.open();
          if (bookDoc) {
            coverBlob = await bookDoc.getCover();
            if (bookDoc.metadata) {
              if (bookDoc.metadata.title) parsedTitle = stringifyMetadataField(bookDoc.metadata.title);
              if (bookDoc.metadata.author) parsedAuthor = stringifyMetadataField(bookDoc.metadata.author);
            }
          }
        } catch (err) {
          console.warn("解析电子书元数据或封面失败:", err);
        }
      } else {
        console.info(
          `跳过超大 PDF 元数据解析（${(localFile.size / 1024 / 1024).toFixed(0)}MB），直接上传`
        );
      }

      const activeGroup = (selectedFilter !== "all" && selectedFilter !== "uncategorized" && selectedFilter !== "reading" && selectedFilter !== "finished") ? selectedFilter : null;
      await api.books.import(localFile, activeGroup, coverBlob || undefined, parsedTitle, parsedAuthor);
      fetchData();
    } catch (err) {
      console.error("导入书籍失败:", err);
      alert("导入书籍失败: " + formatImportError(err));
    } finally {
      if (manageUploading) setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // 同步取出 FileList 引用，再立刻 materialize（input value 清空前）
    const picked = files[0];
    await processAndImportBook(picked);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    setIsUploading(true);
    try {
      // 支持：普通 epub/pdf 文件 + macOS/Apple Books 解包 .epub 目录（自动打成 zip）
      const rawFiles = await collectBookFilesFromDataTransfer(e.dataTransfer);
      if (rawFiles.length === 0) {
        alert("未识别到可导入的电子书文件。若是 Apple Books 的 .epub 包，请直接拖到此区域。");
        return;
      }

      // 小文件立刻 materialize（防拖放句柄失效）；大文件（如 400MB PDF）原样交给 processAndImportBook
      const prepared: { file: File; alreadyMaterialized: boolean }[] = [];
      for (const f of rawFiles) {
        if (f.size > LARGE_BOOK_BYTES) {
          prepared.push({ file: f, alreadyMaterialized: false });
        } else {
          prepared.push({ file: await materializeFile(f), alreadyMaterialized: true });
        }
      }

      for (const item of prepared) {
        await processAndImportBook(item.file, {
          alreadyMaterialized: item.alreadyMaterialized,
          manageUploading: false,
        });
      }
    } catch (err) {
      console.error("导入书籍失败:", err);
      alert("导入书籍失败: " + formatImportError(err));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteBook = async (bookHash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要彻底删除这本书籍及其关联的笔记吗？此操作不可恢复。")) return;
    try {
      await api.books.delete(bookHash);
      fetchData();
    } catch (err) {
      console.error("删除书籍失败:", err);
      alert("删除书籍失败，可能权限不足。");
    }
  };

  const handleEditClick = (book: Book, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBook(book);
    setEditTitle(book.title);
    setEditAuthor(book.author || "未知作者");
    setEditGroupId(book.groupId || "");
    setEditVisibility(book.visibility || "PRIVATE");
  };

  const handleSaveEdit = async () => {
    if (!editingBook) return;
    if (!editTitle.trim()) {
      alert("书名不能为空");
      return;
    }
    setIsSavingEdit(true);
    try {
      await api.books.update(editingBook.bookHash, {
        title: editTitle.trim(),
        author: editAuthor.trim(),
        groupId: editGroupId || null,
        visibility: editVisibility,
      });
      setEditingBook(null);
      fetchData();
    } catch (err) {
      console.error("修改书籍信息失败:", err);
      alert("修改失败，只有书籍上传者或管理员可以修改。");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const getHashColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsla(${h}, 70%, 35%, 0.85)`;
  };

  const filteredBooks = books.filter((book) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      book.title.toLowerCase().includes(q) ||
      (book.author && book.author.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex h-full w-full bg-app-bg text-tx-primary overflow-hidden relative">
      {/* Backdrop overlay for mobile sidebar */}
      {showMobileSidebar && (
        <div
          onClick={() => setShowMobileSidebar(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden animate-fade-in"
        />
      )}

      {/* Sidebar for library groups */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-40 w-64 border-r border-app-border bg-app-surface flex flex-col shrink-0 transition-transform duration-300 overflow-hidden md:relative md:translate-x-0 md:bg-app-surface/30 md:z-0",
        showMobileSidebar ? "translate-x-0 pointer-events-auto" : "-translate-x-full md:translate-x-0 pointer-events-none md:pointer-events-auto"
      )}>
        <div className="p-4 border-b border-app-border flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <BookOpen size={16} className="text-accent-primary" />
            电子书库
          </h2>
          <button
            onClick={() => setShowMobileSidebar(false)}
            className="p-1 rounded-lg hover:bg-app-border text-tx-tertiary md:hidden transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filters：阅读中优先并默认选中 */}
        <div className="p-3 border-b border-app-border space-y-1">
          <button
            onClick={() => {
              setSelectedFilter("reading");
              setShowMobileSidebar(false);
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-between ${
              selectedFilter === "reading"
                ? "bg-accent-primary/10 text-accent-primary"
                : "hover:bg-app-surface text-tx-secondary"
            }`}
          >
            <span>阅读中</span>
          </button>
          <button
            onClick={() => {
              setSelectedFilter("all");
              setShowMobileSidebar(false);
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-between ${
              selectedFilter === "all"
                ? "bg-accent-primary/10 text-accent-primary"
                : "hover:bg-app-surface text-tx-secondary"
            }`}
          >
            <span>全部书籍</span>
          </button>
          <button
            onClick={() => {
              setSelectedFilter("finished");
              setShowMobileSidebar(false);
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-between ${
              selectedFilter === "finished"
                ? "bg-accent-primary/10 text-accent-primary"
                : "hover:bg-app-surface text-tx-secondary"
            }`}
          >
            <span>已读完</span>
          </button>
          <button
            onClick={() => {
              setSelectedFilter("uncategorized");
              setShowMobileSidebar(false);
            }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-between ${
              selectedFilter === "uncategorized"
                ? "bg-accent-primary/10 text-accent-primary"
                : "hover:bg-app-surface text-tx-secondary"
            }`}
          >
            <span>未分类</span>
          </button>
        </div>

        {/* Category Groups list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <div className="px-2 mb-2 text-[10px] uppercase font-bold tracking-wider text-tx-tertiary">
              全部分类
            </div>
            <div className="space-y-1">
              {groups.map((group) => (
                <div
                  key={group.id}
                  onClick={() => {
                    setSelectedFilter(group.id);
                    setShowMobileSidebar(false);
                  }}
                  className={`group/item w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                    selectedFilter === group.id
                      ? "bg-accent-primary/10 text-accent-primary"
                      : "hover:bg-app-surface text-tx-secondary"
                  }`}
                >
                  <span className="truncate flex items-center gap-2">
                    <Folder size={14} className="shrink-0" />
                    {group.name}
                  </span>
                  <button
                    onClick={(e) => handleDeleteGroup(group.id, e)}
                    className="opacity-0 group-hover/item:opacity-100 hover:text-red-500 p-0.5 rounded transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {groups.length === 0 && (
                <div className="text-tx-tertiary text-xs text-center py-4 italic">
                  暂无分类
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Add Group Form — 仅桌面；移动端不提供创建分类/合集 */}
        <form onSubmit={handleCreateGroup} className="hidden md:block p-3 border-t border-app-border bg-app-surface/10">
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="新增分类..."
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="flex-1 px-2.5 py-1.5 bg-app-surface border border-app-border rounded-lg text-xs focus:outline-none focus:border-accent-primary transition-colors text-tx-primary"
            />
            <button
              type="submit"
              className="p-1.5 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/95 flex items-center justify-center shrink-0"
            >
              <FolderPlus size={14} />
            </button>
          </div>
        </form>
      </div>

      {/* Main Books Grid */}
      <div
        className={`flex-1 flex flex-col overflow-hidden relative transition-all ${isDragging ? "bg-accent-primary/5" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-accent-primary/10 backdrop-blur-[2px] border-2 border-dashed border-accent-primary m-4 rounded-xl flex flex-col items-center justify-center pointer-events-none animate-pulse">
            <Upload size={48} className="text-accent-primary mb-3" />
            <p className="text-sm font-semibold text-accent-primary">松开鼠标即可导入书籍</p>
            <p className="text-xs text-tx-tertiary mt-1">支持 EPUB, PDF, MOBI, AZW, CBZ, FB2 格式</p>
          </div>
        )}
        {/* 工具条：与文件/媒体同密度（分类 + 搜索） */}
        <div className="px-3 md:px-6 py-2 md:py-3 border-b border-app-border bg-app-surface/30 flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowMobileSidebar((prev) => !prev)}
            className="p-2 rounded-xl border border-app-border bg-app-bg text-tx-secondary hover:text-accent-primary md:hidden shrink-0 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
            title="切换分类"
          >
            <Menu size={16} />
          </button>
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary" />
            <input
              type="text"
              placeholder="搜索书籍、作者..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 h-9 bg-app-bg border border-app-border rounded-xl text-xs focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 transition-colors text-tx-primary"
            />
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".epub,.pdf,.mobi,.azw,.azw3,.cbz,.fb2"
            className="hidden"
          />
        </div>

        {/* 「阅读中」：桌面 / 移动共用 ReadingDashboard 仪表盘 */}
        {selectedFilter === "reading" && !searchQuery ? (
          <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
            {loading ? (
              <LoadingBlock label="加载书库中…" className="h-64" />
            ) : (
              <ReadingDashboard books={filteredBooks} onOpenBook={onOpenBook} />
            )}
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 pb-[calc(1.25rem+var(--safe-area-bottom,0px))]">
          {loading ? (
            <LoadingBlock label="加载书库中…" className="h-64" />
          ) : filteredBooks.length === 0 && !searchQuery ? (
            <EmptyState
              icon={BookOpen}
              title="书架还是空的"
              description="导入 EPUB / PDF 等。Apple Books 解包的 .epub 包请拖到此区域（会自动打包），或先选 *-fixed.epub"
              action={
                <EmptyActionButton onClick={handleUploadClick}>
                  导入书籍
                </EmptyActionButton>
              }
              className="h-64"
            />
          ) : (
            // 固定封面宽高，与「阅读中」仪表盘封面一致（不随栅格列数被拉大/压小）
            <div className="flex flex-wrap gap-2.5 sm:gap-3 md:gap-4">
              {filteredBooks.map((book) => {
                const coverBg = getHashColor(book.title);
                let coverUrl: string | null = null;
                if (book.metadata) {
                  try {
                    const meta = JSON.parse(book.metadata);
                    if (meta.coverAttachmentId) {
                      coverUrl = resolveAttachmentUrl(`/api/attachments/${meta.coverAttachmentId}`);
                    }
                  } catch {}
                }
                return (
                  <div
                    key={book.bookHash}
                    onClick={() => onOpenBook(book.bookHash)}
                    className={cn(
                      "group relative flex flex-col cursor-pointer active:scale-[0.98] transition-all shrink-0",
                      BOOK_COVER_WIDTH_CLASS,
                    )}
                  >
                    {/*
                      封面层：底色 + 书名始终铺在底层；有 coverUrl 时 img 盖在上面。
                      图片 404/跨域失败时 onError 藏图，自动露出书名色块（避免纯色无字）。
                    */}
                    <div
                      className="aspect-[3/4] w-full relative overflow-hidden rounded-md shadow-sm border border-app-border/30 select-none"
                      style={{ backgroundColor: coverBg }}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1.5 z-[1] bg-gradient-to-r from-black/25 via-white/10 to-transparent pointer-events-none" />
                      <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center px-2 text-center pointer-events-none">
                        <h3 className="text-[11px] sm:text-xs font-bold text-white leading-tight font-serif line-clamp-4 drop-shadow">
                          {book.title}
                        </h3>
                        <p className="text-[9px] text-white/80 mt-1 line-clamp-1 hidden sm:block">
                          {book.author || "未知作者"}
                        </p>
                      </div>
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt={book.title}
                          className="absolute inset-0 z-[2] w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            // 藏图后露出底层色块+书名
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}

                      <div className="absolute top-1.5 left-1.5 z-[3] opacity-0 md:group-hover:opacity-100 flex items-center gap-1 transition-opacity bg-black/60 rounded-md p-0.5 shadow">
                        <button
                          onClick={(e) => handleEditClick(book, e)}
                          className="p-1 text-white hover:text-accent-primary hover:bg-white/10 rounded transition-all"
                          title="编辑信息"
                        >
                          <Edit size={12} />
                        </button>
                        <button
                          onClick={(e) => handleDeleteBook(book.bookHash, e)}
                          className="p-1 text-white hover:text-red-400 hover:bg-white/10 rounded transition-all"
                          title="删除书籍"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 px-0.5">
                      <div className="text-[12px] sm:text-[13px] font-medium text-tx-primary line-clamp-2 leading-snug group-hover:text-accent-primary transition-colors">
                        {book.title}
                      </div>
                      <div className="text-[10px] text-tx-tertiary truncate mt-0.5 hidden md:block">
                        {book.author || "未知作者"}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* 与书籍封面同尺寸的加号卡片 → 导入书籍 */}
              <button
                type="button"
                onClick={handleUploadClick}
                disabled={isUploading}
                title="导入书籍"
                aria-label="导入书籍"
                className={cn(
                  "group relative flex flex-col cursor-pointer active:scale-[0.98] transition-all text-left disabled:opacity-60 disabled:cursor-wait shrink-0",
                  BOOK_COVER_WIDTH_CLASS,
                )}
              >
                <div className="aspect-[3/4] w-full relative overflow-hidden rounded-md shadow-sm border border-app-border/40 bg-white dark:bg-app-surface flex items-center justify-center hover:border-accent-primary/40 hover:bg-app-hover/40 transition-colors">
                  {isUploading ? (
                    <Loader2 size={36} className="animate-spin text-accent-primary" />
                  ) : (
                    <Plus
                      size={40}
                      strokeWidth={1.5}
                      className="text-tx-tertiary/70 group-hover:text-accent-primary transition-colors"
                    />
                  )}
                </div>
                {/* 占位与书籍标题区等高，保持网格对齐 */}
                <div className="mt-2 px-0.5 min-h-[1.25rem] sm:min-h-[2rem]" aria-hidden />
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Edit Metadata Modal */}
      {editingBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-app-surface border border-app-border rounded-2xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-app-border flex justify-between items-center bg-app-surface/50">
              <h3 className="text-sm font-bold text-tx-primary flex items-center gap-2">
                <Edit size={16} className="text-accent-primary" />
                修改书籍元数据
              </h3>
              <button
                onClick={() => setEditingBook(null)}
                className="p-1 rounded-lg hover:bg-app-border text-tx-tertiary transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              {/* Title input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
                  书名
                </label>
                <div className="relative">
                  <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" />
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-app-bg border border-app-border rounded-lg text-xs text-tx-primary focus:outline-none focus:border-accent-primary"
                  />
                </div>
              </div>

              {/* Author input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
                  作者
                </label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" />
                  <input
                    type="text"
                    value={editAuthor}
                    onChange={(e) => setEditAuthor(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-app-bg border border-app-border rounded-lg text-xs text-tx-primary focus:outline-none focus:border-accent-primary"
                  />
                </div>
              </div>

              {/* Category input */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
                  分类归属
                </label>
                <div className="relative">
                  <Folder size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" />
                  <select
                    value={editGroupId}
                    onChange={(e) => setEditGroupId(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-app-bg border border-app-border rounded-lg text-xs text-tx-primary focus:outline-none focus:border-accent-primary appearance-none"
                  >
                    <option value="">未分类</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Sharing visibility permissions (Workspace context only) */}
              {workspaceId && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
                    共享范围
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setEditVisibility("PRIVATE")}
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                        editVisibility === "PRIVATE"
                          ? "border-accent-primary bg-accent-primary/5 text-accent-primary"
                          : "border-app-border hover:bg-app-surface text-tx-secondary"
                      }`}
                    >
                      <Lock size={14} />
                      <span>私有</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditVisibility("WORKSPACE")}
                      className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                        editVisibility === "WORKSPACE"
                          ? "border-emerald-500 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                          : "border-app-border hover:bg-app-surface text-tx-secondary"
                      }`}
                    >
                      <Globe size={14} />
                      <span>工作区共享</span>
                    </button>
                  </div>
                  <p className="text-[9px] text-tx-tertiary mt-1">
                    * 上传书籍默认为私有，共享后工作区所有成员均可在各自书库看到并打开阅读。
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-app-border flex justify-end gap-3 bg-app-surface/50">
              <button
                type="button"
                onClick={() => setEditingBook(null)}
                className="px-4 py-2 border border-app-border rounded-lg text-xs font-semibold text-tx-secondary hover:bg-app-surface transition-all"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="px-4 py-2 bg-accent-primary text-white rounded-lg text-xs font-semibold hover:bg-accent-primary/95 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isSavingEdit && <Loader2 size={12} className="animate-spin" />}
                <span>保存</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
