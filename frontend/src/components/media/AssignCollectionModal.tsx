/**
 * 合入合集：将选中媒体挂到一个或多个自定义合集（不移出原合集）
 */
import React, { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { FolderPlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Motion } from "@/components/common/Motion";
import { springs, variants } from "@/lib/motion";

export interface AssignCollectionOption {
  id: string;
  title: string;
  type: "video" | "audio";
}

interface AssignCollectionModalProps {
  open: boolean;
  mediaIds: string[];
  /** 当前库类型，只展示同 type 合集 */
  mediaType: "video" | "audio";
  collections: AssignCollectionOption[];
  workspaceId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AssignCollectionModal({
  open,
  mediaIds,
  mediaType,
  collections,
  workspaceId,
  onClose,
  onSuccess,
}: AssignCollectionModalProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const options = useMemo(
    () => collections.filter((c) => c.type === mediaType),
    [collections, mediaType],
  );

  // 打开时重置
  React.useEffect(() => {
    if (open) {
      setPicked(new Set());
      setError("");
      setSaving(false);
    }
  }, [open]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (mediaIds.length === 0 || picked.size === 0) return;
    setSaving(true);
    setError("");
    try {
      const q = workspaceId ? `?workspaceId=${workspaceId}` : "";
      await api.request(`/media/items/assign-collections${q}`, {
        method: "POST",
        body: JSON.stringify({
          ids: mediaIds,
          collection_ids: Array.from(picked),
        }),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || "合入失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="presentation"
        >
          <Motion.div
            variants={variants.scrimFade}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={springs.modal}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <Motion.div
            role="dialog"
            aria-modal
            aria-labelledby="assign-collection-title"
            variants={variants.fadeScaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={springs.modal}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-app-border bg-app-elevated shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <FolderPlus size={16} className="text-accent-primary shrink-0" />
                <h3 id="assign-collection-title" className="text-sm font-bold text-tx-primary truncate">
                  合入到合集
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md text-tx-tertiary hover:bg-app-hover active:scale-[0.97] transition-transform duration-press ease-out"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              <p className="text-xs text-tx-tertiary leading-relaxed">
                已选 <span className="text-accent-primary font-semibold">{mediaIds.length}</span> 个
                {mediaType === "audio" ? "音频" : "视频"}。合入不会移出原合集，同一文件可属于多个合集。
              </p>

              {options.length === 0 ? (
                <p className="text-xs text-tx-tertiary py-6 text-center">
                  暂无可用的自定义合集，请先新建合集
                </p>
              ) : (
                <ul className="max-h-56 overflow-y-auto space-y-1 border border-app-border rounded-xl p-1.5 bg-app-bg/40">
                  {options.map((col) => {
                    const checked = picked.has(col.id);
                    return (
                      <li key={col.id}>
                        <button
                          type="button"
                          onClick={() => toggle(col.id)}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors",
                            checked
                              ? "bg-accent-primary/10 text-accent-primary"
                              : "text-tx-primary hover:bg-app-hover",
                          )}
                        >
                          <span
                            className={cn(
                              "w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px]",
                              checked
                                ? "bg-accent-primary border-accent-primary text-white"
                                : "border-app-border",
                            )}
                          >
                            {checked ? "✓" : ""}
                          </span>
                          <span className="truncate font-medium">{col.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {error && (
                <p className="text-xs text-accent-danger bg-accent-danger/5 border border-accent-danger/15 rounded-lg px-2 py-1.5">
                  {error}
                </p>
              )}
            </div>

            <div className="px-4 py-3 border-t border-app-border flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium border border-app-border bg-app-surface text-tx-primary hover:bg-app-hover active:scale-[0.97] transition-transform duration-press ease-out"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving || picked.size === 0 || mediaIds.length === 0}
                onClick={() => void handleConfirm()}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-opacity active:scale-[0.97]",
                  picked.size > 0 && mediaIds.length > 0
                    ? "bg-accent-primary text-white hover:opacity-90"
                    : "bg-app-sidebar text-tx-tertiary cursor-not-allowed",
                )}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                合入
              </button>
            </div>
          </Motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
