/**
 * 任务事务分类管理
 * - 查看树（含停用）
 * - 改名 / 停用·启用
 * - 新增子类
 * - 同步家庭预设
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Tags,
  Pencil,
  EyeOff,
  Eye,
} from "lucide-react";
import { api, getCurrentWorkspace } from "@/lib/api";
import type { TaskCategory } from "@/types";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/layout/PageHeader";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppModal } from "@/components/common/AppModal";
import { EmptyState, LoadingBlock } from "@/components/common/FeedbackStates";
import { toast } from "@/lib/toast";
import { confirm as confirmDialog } from "@/components/ui/confirm";

type CatNode = TaskCategory & { children?: CatNode[] };

function flattenForParentOptions(
  nodes: CatNode[],
  depth = 0,
  acc: Array<{ id: string; label: string }> = [],
): Array<{ id: string; label: string }> {
  for (const n of nodes) {
    if (n.isActive !== 0) {
      acc.push({ id: n.id, label: `${"　".repeat(depth)}${n.name} (${n.code})` });
      if (n.children?.length) flattenForParentOptions(n.children, depth + 1, acc);
    }
  }
  return acc;
}

function CategoryRow({
  node,
  depth,
  onRename,
  onToggleActive,
  onAddChild,
}: {
  node: CatNode;
  depth: number;
  onRename: (node: CatNode) => void;
  onToggleActive: (node: CatNode) => void;
  onAddChild: (parent: CatNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasKids = !!(node.children && node.children.length > 0);
  const inactive = node.isActive === 0;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1.5 min-h-11 px-2 py-1.5 rounded-button",
          "hover:bg-app-hover/60",
          inactive && "opacity-50",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          className="w-7 h-7 inline-flex items-center justify-center rounded-button text-tx-tertiary shrink-0"
          onClick={() => hasKids && setOpen((v) => !v)}
          aria-label={open ? "折叠" : "展开"}
          disabled={!hasKids}
        >
          {hasKids ? (
            open ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-app-border" />
          )}
        </button>

        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: node.color || "var(--color-accent-primary, #6366f1)" }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn("text-sm font-medium truncate", inactive && "line-through")}>
              {node.name}
            </span>
            {node.isPreset === 1 && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-app-hover text-tx-tertiary shrink-0">
                预设
              </span>
            )}
            {inactive && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-app-hover text-tx-tertiary shrink-0">
                已停用
              </span>
            )}
            {node.kind && node.kind !== "normal" && (
              <span className="text-[10px] text-tx-tertiary shrink-0">{node.kind}</span>
            )}
          </div>
          {node.description ? (
            <div className="text-[10px] text-tx-tertiary leading-snug mt-0.5 line-clamp-2">
              {node.description}
            </div>
          ) : (
            <div className="text-[10px] font-mono text-tx-tertiary truncate">{node.code}</div>
          )}
          {node.description && (
            <div className="text-[9px] font-mono text-tx-quaternary truncate mt-0.5">{node.code}</div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-fast">
          <button
            type="button"
            title="添加子类"
            onClick={() => onAddChild(node)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-button text-tx-secondary hover:bg-app-hover"
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            title="编辑名称与说明"
            onClick={() => onRename(node)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-button text-tx-secondary hover:bg-app-hover"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            title={inactive ? "启用" : "停用"}
            onClick={() => onToggleActive(node)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-button text-tx-secondary hover:bg-app-hover"
          >
            {inactive ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </div>
      </div>

      {hasKids && open &&
        node.children!.map((ch) => (
          <CategoryRow
            key={ch.id}
            node={ch}
            depth={depth + 1}
            onRename={onRename}
            onToggleActive={onToggleActive}
            onAddChild={onAddChild}
          />
        ))}
    </div>
  );
}

export default function TaskCategoryManager({
  embedded = false,
}: {
  /** 嵌入「任务复盘」内时隐藏独立页头，只渲染内容 */
  embedded?: boolean;
}) {
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspace());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [items, setItems] = useState<TaskCategory[]>([]);
  const [treeAll, setTreeAll] = useState<CatNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  // rename modal
  const [renameTarget, setRenameTarget] = useState<CatNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameDesc, setRenameDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string>("");
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createDesc, setCreateDesc] = useState("");

  useEffect(() => {
    const onWs = (e: Event) => {
      const custom = e as CustomEvent<{ workspaceId?: string }>;
      setWorkspaceId(custom.detail?.workspaceId || getCurrentWorkspace());
    };
    window.addEventListener("super:workspace-changed", onWs);
    return () => window.removeEventListener("super:workspace-changed", onWs);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTaskCategories(workspaceId || null);
      setItems(res.items || []);
      setTreeAll((res as any).treeAll || res.tree || []);
    } catch (e: any) {
      setError(e?.message || "加载失败");
      setItems([]);
      setTreeAll([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const parentOptions = useMemo(() => flattenForParentOptions(treeAll), [treeAll]);
  const activeCount = items.filter((i) => i.isActive !== 0).length;

  const handleSyncPreset = async () => {
    const ok = await confirmDialog({
      title: "同步家庭预设？",
      description:
        "将按稳定编码补齐/更新预设分类名称与说明（不删你的自定义分类）。预设项的显示名与说明会被预设内容覆盖。",
      confirmText: "同步",
    });
    if (!ok) return;
    setSyncing(true);
    try {
      const r = await api.applyTaskCategoryPreset(workspaceId || null);
      toast.success(`已同步（新建 ${r.created}，更新 ${r.updated}）`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const openRename = (node: CatNode) => {
    setRenameTarget(node);
    setRenameValue(node.name);
    setRenameDesc(node.description || "");
  };

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setSaving(true);
    try {
      await api.updateTaskCategory(renameTarget.id, {
        name: renameValue.trim(),
        description: renameDesc.trim() || null,
      });
      toast.success("已保存");
      setRenameTarget(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (node: CatNode) => {
    const nextActive = node.isActive === 0;
    if (!nextActive) {
      const ok = await confirmDialog({
        title: "停用该分类？",
        description: "停用后新建任务时不可选，历史统计仍按原分类聚合。可随时重新启用。",
        confirmText: "停用",
      });
      if (!ok) return;
    }
    try {
      await api.updateTaskCategory(node.id, { isActive: nextActive });
      toast.success(nextActive ? "已启用" : "已停用");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "操作失败");
    }
  };

  const openCreate = (parent?: CatNode | null) => {
    setCreateParentId(parent?.id || "");
    setCreateName("");
    setCreateDesc("");
    const suggest = parent ? `${parent.code}.x` : "custom";
    setCreateCode(suggest);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!createName.trim() || !createCode.trim()) {
      toast.error("请填写名称与编码");
      return;
    }
    setSaving(true);
    try {
      await api.createTaskCategory({
        workspaceId: workspaceId || null,
        parentId: createParentId || null,
        name: createName.trim(),
        code: createCode.trim(),
        description: createDesc.trim() || null,
      });
      toast.success("已创建分类");
      setCreateOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const body = (
        <div className={cn("space-y-4", embedded ? "pb-4" : "pb-24 md:pb-12")}>
          <p className="text-xs text-tx-tertiary leading-relaxed">
            分类是复盘的主维度。编码（code）保持稳定以保证环比；可改显示名、停用或加自定义子类。停用不删历史。
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 min-h-11 md:min-h-8" onClick={handleSyncPreset} disabled={syncing}>
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              同步家庭预设
            </Button>
            <Button size="sm" onClick={() => openCreate(null)} className="gap-1.5 min-h-11 md:min-h-8">
              <Plus size={14} />
              新建
            </Button>
            <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 min-h-11 md:min-h-8 text-tx-secondary">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              刷新
            </Button>
            <span className="text-[11px] text-tx-tertiary self-center ml-auto">
              启用 {activeCount} / 共 {items.length}
            </span>
          </div>

          {loading && items.length === 0 ? (
            <LoadingBlock label="加载分类…" className="py-16" />
          ) : error ? (
            <EmptyState
              icon={Tags}
              title="加载失败"
              description={error}
              action={
                <Button variant="outline" size="sm" onClick={load}>
                  重试
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="还没有事务分类"
              description="导入家庭 6 大类预设，或手动新建分类"
              action={
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button onClick={handleSyncPreset} disabled={syncing} className="gap-1.5">
                    {syncing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    导入家庭预设
                  </Button>
                  <Button variant="outline" onClick={() => openCreate(null)} className="gap-1.5">
                    <Plus size={14} />
                    手动新建
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="rounded-xl border border-app-border/40 bg-app-elevated shadow-xs overflow-hidden py-1">
              {treeAll.map((n) => (
                <CategoryRow
                  key={n.id}
                  node={n}
                  depth={0}
                  onRename={openRename}
                  onToggleActive={handleToggle}
                  onAddChild={(p) => openCreate(p)}
                />
              ))}
            </div>
          )}
        </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col min-h-0",
        embedded ? "w-full" : "flex-1 h-full overflow-hidden bg-app-bg",
      )}
    >
      {!embedded && (
        <>
          <MobileChromeHeader
            variant="bare"
            title="事务分类"
            right={
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => openCreate(null)}
                  className="p-2 rounded-button text-tx-secondary active:scale-[0.97] transition-transform duration-press ease-out"
                  aria-label="新建"
                >
                  <Plus size={18} />
                </button>
                <button
                  type="button"
                  onClick={load}
                  className="p-2 rounded-button text-tx-secondary active:scale-[0.97] transition-transform duration-press ease-out"
                  aria-label="刷新"
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
              </div>
            }
          />
          <PageHeader
            mdOnly
            title={
              <span className="inline-flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-card bg-accent-primary flex items-center justify-center">
                  <Tags size={18} className="text-white" />
                </span>
                <span>
                  <span className="block">事务分类</span>
                  <span className="block text-xs font-normal text-tx-tertiary mt-0.5">
                    任务复盘主维度 · 启用 {activeCount} / 共 {items.length}
                  </span>
                </span>
              </span>
            }
            actions={
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleSyncPreset} disabled={syncing} className="gap-1.5">
                  {syncing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  同步预设
                </Button>
                <Button size="sm" onClick={() => openCreate(null)} className="gap-1.5">
                  <Plus size={14} />
                  新建
                </Button>
              </div>
            }
          />
        </>
      )}

      {embedded ? (
        body
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-4 md:p-6">{body}</div>
        </div>
      )}

      {renameTarget && (
        <AppModal title="编辑分类" onClose={() => !saving && setRenameTarget(null)}>
          <div className="space-y-3 p-1">
            <p className="text-xs text-tx-tertiary font-mono">{renameTarget.code}</p>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-tx-secondary">显示名称</label>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="显示名称"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-tx-secondary">说明（小字 / 气泡）</label>
              <Input
                value={renameDesc}
                onChange={(e) => setRenameDesc(e.target.value)}
                placeholder="例如：主业工作、学习提升、职场应酬"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setRenameTarget(null)} disabled={saving}>
                取消
              </Button>
              <Button onClick={submitRename} disabled={saving || !renameValue.trim()}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : "保存"}
              </Button>
            </div>
          </div>
        </AppModal>
      )}

      {createOpen && (
        <AppModal title="新建分类" onClose={() => !saving && setCreateOpen(false)}>
          <div className="space-y-3 p-1">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-tx-secondary">父分类（可选）</label>
              <select
                className="w-full h-10 px-3 rounded-button border border-app-border bg-app-bg text-sm"
                value={createParentId}
                onChange={(e) => setCreateParentId(e.target.value)}
              >
                <option value="">无（作为顶级大类）</option>
                {parentOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-tx-secondary">显示名称</label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="例如：周末短途"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-tx-secondary">说明（小字 / 气泡）</label>
              <Input
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="帮助理解何时选这类，如：双人短途、纪念日"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-tx-secondary">编码 code（稳定，创建后勿随意改）</label>
              <Input
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                placeholder="例如：2.1.1 或 custom.trip"
                className="font-mono text-sm"
              />
              <p className="text-[10px] text-tx-tertiary">仅字母数字与 . _ -</p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
                取消
              </Button>
              <Button onClick={submitCreate} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : "创建"}
              </Button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}
