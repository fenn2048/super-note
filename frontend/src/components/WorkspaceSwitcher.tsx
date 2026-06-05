/**
 * WorkspaceSwitcher - 工作区切换器（Phase 1 多用户协作）
 *
 * 功能：
 *   - 下拉列出当前用户的所有工作区（含个人空间）
 *   - 切换后触发全局数据重载
 *   - 快捷入口：创建工作区、加入工作区（输入邀请码）
 *   - 管理成员入口
 */
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  ChevronDown,
  Users,
  LogIn,
  X,
  Pencil,
  Trash2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, getCurrentWorkspace, setCurrentWorkspace } from "@/lib/api";
import { Workspace } from "@/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import MembersPanel from "@/components/MembersPanel";
import ContextMenu, { ContextMenuItem } from "@/components/ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";

interface WorkspaceSwitcherProps {
  /** 切换后父组件触发的回调，通常是 reload 数据 */
  onWorkspaceChange?: (workspaceId: string) => void;
  collapsed?: boolean;
}

export default function WorkspaceSwitcher({ onWorkspaceChange, collapsed }: WorkspaceSwitcherProps) {
  const { t } = useTranslation();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [current, setCurrent] = useState<string>(getCurrentWorkspace());
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showMembers, setShowMembers] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { menu, menuRef, openMenu, closeMenu } = useContextMenu();

  const loadWorkspaces = async () => {
    try {
      const list = await api.getWorkspaces();
      setWorkspaces(list);
    } catch (e: any) {
      console.error("[WorkspaceSwitcher] load failed", e);
    }
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  // 系统管理员（users.role='admin'）：可对任意工作区右键编辑/删除——后端中间件已对其旁路。
  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((u) => {
        if (!cancelled) setIsAdmin((u as any)?.role === "admin");
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const switchTo = (id: string) => {
    if (id === current) {
      setOpen(false);
      return;
    }
    setCurrent(id);
    setCurrentWorkspace(id);
    setOpen(false);
    onWorkspaceChange?.(id);
    // 触发页面重载以刷新所有数据
    window.dispatchEvent(new CustomEvent("nowen:workspace-changed", { detail: { workspaceId: id } }));
  };

  const currentWs = workspaces.find((w) => w.id === current);
  const displayName = current === "personal" ? "个人空间" : currentWs?.name || "个人空间";
  const displayIcon = current === "personal" ? "🏠" : currentWs?.icon || "🏢";

  // 在入口按钮（展开/收起态）上右键当前工作区时，直接弹出对应右键菜单。
  // 个人空间没有可管理选项，不弹菜单（避免空菜单）。
  const handleEntryContextMenu = (e: React.MouseEvent) => {
    if (current === "personal") return;
    const target = workspaces.find((w) => w.id === current);
    if (!target) return;
    const canManage = target.role === "owner" || target.role === "admin" || isAdmin;
    const canEditDelete = target.role === "owner" || isAdmin;
    if (!canManage && !canEditDelete) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(e, target.id, "workspace");
  };

  if (collapsed) {
    return (
      <>
        <button
          className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-accent transition-colors"
          title={displayName}
          onClick={() => setOpen(true)}
          onContextMenu={handleEntryContextMenu}
        >
          <span className="text-xl">{displayIcon}</span>
        </button>
        {/* 收起态下右键菜单及其衍生弹窗复用展开态分支同一份渲染逻辑，避免代码冗余 */}
        {renderContextMenuAndDialogs()}
      </>
    );
  }

  function renderContextMenuAndDialogs() {
    return (
      <>
        {showMembers && (
          <MembersPanel
            workspaceId={showMembers}
            onClose={() => {
              setShowMembers(null);
              loadWorkspaces();
            }}
          />
        )}
        {(() => {
          if (!menu.isOpen || menu.targetType !== "workspace" || !menu.targetId) return null;
          const target = workspaces.find((w) => w.id === menu.targetId);
          if (!target) return null;
          const canManage = target.role === "owner" || target.role === "admin" || isAdmin;
          const canEditDelete = target.role === "owner" || isAdmin;
          const items: ContextMenuItem[] = [];
          if (canManage) {
            items.push({
              id: "members",
              label: t("workspaceSwitcher.contextMenu.manageMembers", "管理成员"),
              icon: <Users className="w-3.5 h-3.5" />,
            });
          }
          if (canEditDelete) {
            if (items.length > 0) items.push({ id: "sep1", label: "", separator: true });
            items.push({
              id: "edit",
              label: t("workspaceSwitcher.contextMenu.edit", "编辑工作区"),
              icon: <Pencil className="w-3.5 h-3.5" />,
            });
            items.push({
              id: "delete",
              label: t("workspaceSwitcher.contextMenu.delete", "删除工作区"),
              icon: <Trash2 className="w-3.5 h-3.5" />,
              danger: true,
            });
          }
          if (items.length === 0) return null;
          return (
            <ContextMenu
              isOpen={menu.isOpen}
              x={menu.x}
              y={menu.y}
              items={items}
              menuRef={menuRef}
              header={target.name}
              onAction={(actionId) => {
                closeMenu();
                if (actionId === "members") {
                  setShowMembers(target.id);
                } else if (actionId === "edit") {
                  setEditing(target);
                } else if (actionId === "delete") {
                  setDeleting(target);
                }
              }}
            />
          );
        })()}
        {editing && (
          <EditWorkspaceDialog
            workspace={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              loadWorkspaces();
            }}
          />
        )}
        {deleting && (
          <DeleteWorkspaceDialog
            workspace={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={() => {
              const removedId = deleting.id;
              setDeleting(null);
              if (current === removedId) {
                setCurrent("personal");
                setCurrentWorkspace("personal");
                onWorkspaceChange?.("personal");
                window.dispatchEvent(
                  new CustomEvent("nowen:workspace-changed", {
                    detail: { workspaceId: "personal" },
                  }),
                );
              }
              loadWorkspaces();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          onContextMenu={handleEntryContextMenu}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border",
            "bg-background hover:bg-accent transition-colors text-sm",
          )}
        >
          <span className="text-lg">{displayIcon}</span>
          <div className="flex-1 text-left truncate">
            <div className="font-medium truncate">{displayName}</div>
            {currentWs && (
              <div className="text-xs text-muted-foreground">
                {currentWs.role} · {currentWs.memberCount} 位成员
              </div>
            )}
          </div>
          <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
            >
              <div className="max-h-[320px] overflow-auto py-1">
                {/* 个人空间 */}
                <WorkspaceItem
                  icon="🏠"
                  name="个人空间"
                  subtitle="仅自己可见"
                  active={current === "personal"}
                  onClick={() => switchTo("personal")}
                />
                {workspaces.length > 0 && (
                  <div className="mx-2 my-1 border-t border-border" />
                )}
                {workspaces.map((w) => (
                  <WorkspaceItem
                    key={w.id}
                    icon={w.icon || "🏢"}
                    name={w.name}
                    subtitle={`${w.role} · ${w.memberCount} 位成员`}
                    active={current === w.id}
                    onClick={() => switchTo(w.id)}
                    onManage={
                      w.role === "owner" || w.role === "admin" || isAdmin
                        ? () => {
                            setOpen(false);
                            setShowMembers(w.id);
                          }
                        : undefined
                    }
                    onContextMenu={(e) => {
                      // 只有 owner / 工作区 admin / 系统管理员 才有右键菜单。
                      // 注意：这里**不**主动 setOpen(false)——之前那样写会导致
                      // 下拉立即收起、用户视觉上看到"菜单弹出但下拉消失"的割裂
                      // 体验。下拉与右键菜单本就互不重叠（菜单跟随鼠标，下拉
                      // 锚定按钮），完全可以共存；用户做完动作（点菜单项 / 点空白）
                      // 后下拉会自然关闭。
                      if (w.role === "owner" || w.role === "admin" || isAdmin) {
                        openMenu(e, w.id, "workspace");
                      }
                    }}
                  />
                ))}
              </div>
              <div className="border-t border-border p-1">
                <button
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent"
                  onClick={() => {
                    setOpen(false);
                    setShowCreate(true);
                  }}
                >
                  <Plus className="w-4 h-4" />
                  创建工作区
                </button>
                <button
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent"
                  onClick={() => {
                    setOpen(false);
                    setShowJoin(true);
                  }}
                >
                  <LogIn className="w-4 h-4" />
                  使用邀请码加入
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showCreate && (
        <CreateWorkspaceDialog
          onClose={() => setShowCreate(false)}
          onCreated={(ws) => {
            setShowCreate(false);
            loadWorkspaces();
            switchTo(ws.id);
          }}
        />
      )}

      {showJoin && (
        <JoinWorkspaceDialog
          onClose={() => setShowJoin(false)}
          onJoined={(workspaceId) => {
            setShowJoin(false);
            loadWorkspaces();
            switchTo(workspaceId);
          }}
        />
      )}

      {renderContextMenuAndDialogs()}
    </>
  );
}

/* ========== 下拉项 ========== */
function WorkspaceItem({
  icon,
  name,
  subtitle,
  active,
  onClick,
  onManage,
  onContextMenu,
}: {
  icon: string;
  name: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
  onManage?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 mx-1 rounded cursor-pointer group",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
      {onManage && (
        <button
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background"
          onClick={(e) => {
            e.stopPropagation();
            onManage();
          }}
          title="管理成员"
        >
          <Users className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/* ========== 创建工作区对话框 ========== */
function CreateWorkspaceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (ws: Workspace) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("🏢");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("请输入工作区名称");
      return;
    }
    setLoading(true);
    try {
      const ws = await api.createWorkspace({ name: name.trim(), description, icon });
      toast.success("工作区创建成功");
      onCreated(ws);
    } catch (e: any) {
      toast.error(e.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="创建工作区" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-sm mb-1 block">图标</label>
          <Input
            value={icon}
            maxLength={4}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🏢"
            className="w-20 text-center text-lg"
          />
        </div>
        <div>
          <label className="text-sm mb-1 block">
            名称 <span className="text-destructive">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：研发团队"
            autoFocus
          />
        </div>
        <div>
          <label className="text-sm mb-1 block">描述（可选）</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="简短说明"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "创建中..." : "创建"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ========== 加入工作区对话框 ========== */
function JoinWorkspaceDialog({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (workspaceId: string) => void;
}) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!code.trim()) {
      toast.error("请输入邀请码");
      return;
    }
    setLoading(true);
    try {
      const res = await api.joinWorkspace(code.trim());
      if (res.alreadyMember) {
        toast.info("您已是该工作区成员");
        onJoined(res.workspaceId!);
      } else {
        toast.success(`已加入工作区：${res.workspace?.name}`);
        onJoined(res.workspace!.id);
      }
    } catch (e: any) {
      toast.error(e.message || "加入失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="使用邀请码加入工作区" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-sm mb-1 block">邀请码</label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF1234"
            autoFocus
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">向工作区管理员索要邀请码</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleJoin} disabled={loading}>
            {loading ? "加入中..." : "加入"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ========== 编辑工作区对话框 ========== */
function EditWorkspaceDialog({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description || "");
  const [icon, setIcon] = useState(workspace.icon || "🏢");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("workspaceManagement.fieldName", "名称"));
      return;
    }
    const payload: { name?: string; description?: string; icon?: string } = {};
    if (trimmed !== workspace.name) payload.name = trimmed;
    if (description !== (workspace.description || "")) payload.description = description;
    if (icon !== (workspace.icon || "🏢")) payload.icon = icon;
    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    setLoading(true);
    try {
      await api.updateWorkspace(workspace.id, payload);
      toast.success(t("workspaceManagement.saveSuccess", "已保存"));
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || t("workspaceManagement.saveFailed", "保存失败"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t("workspaceManagement.editTitle", { name: workspace.name, defaultValue: `编辑：${workspace.name}` })}
      onClose={() => !loading && onClose()}
    >
      <div className="space-y-3">
        <div>
          <label className="text-sm mb-1 block">
            {t("workspaceManagement.fieldIcon", "图标")}
          </label>
          <Input
            value={icon}
            maxLength={4}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🏢"
            className="w-20 text-center text-lg"
          />
        </div>
        <div>
          <label className="text-sm mb-1 block">
            {t("workspaceManagement.fieldName", "名称")}{" "}
            <span className="text-destructive">*</span>
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="text-sm mb-1 block">
            {t("workspaceManagement.fieldDescription", "描述")}
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t("common.cancel", "取消")}
          </Button>
          <Button onClick={handleSave} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            {t("workspaceManagement.save", "保存")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ========== 删除工作区对话框 ========== */
function DeleteWorkspaceDialog({
  workspace,
  onClose,
  onDeleted,
}: {
  workspace: Workspace;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      await api.deleteWorkspace(workspace.id);
      toast.success(t("workspaceManagement.deleteSuccess", "已删除"));
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message || t("workspaceManagement.deleteFailed", "删除失败"));
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t("workspaceManagement.deleteTitle", {
        name: workspace.name,
        defaultValue: `删除：${workspace.name}`,
      })}
      onClose={() => !loading && onClose()}
    >
      <div className="space-y-4 text-sm">
        <div className="p-3 rounded-lg bg-red-50/60 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
            {t(
              "workspaceManagement.deleteConfirmHintNoOwner",
              "删除后该工作区下的笔记本将归还到所有者的个人空间，邀请码、成员关系会被清除，此操作不可撤销。",
            )}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t("common.cancel", "取消")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            {t("workspaceManagement.confirmDelete", "确认删除")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ========== 通用 Modal ========== */
export function Modal({
  title,
  children,
  onClose,
  widthClass = "max-w-md",
  heightClass,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  widthClass?: string;
  /**
   * 可选的高度约束。不传 → 内容自然高度；传如 "h-[80vh]" / "max-h-[80vh]" → 固定/限高
   * 弹窗，body 区域自动滚动。
   */
  heightClass?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15 }}
        className={cn(
          "bg-card border border-border rounded-lg shadow-xl w-full flex flex-col",
          widthClass,
          heightClass,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h3 className="font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-accent"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/*
          body 区域：flex-1 + min-h-0 让其在设置了 heightClass 时能正确收缩并
          启用内部滚动；未设高度时（默认）仅按内容自然撑开，表现与旧版一致。
        */}
        <div className="p-4 flex-1 min-h-0 overflow-auto">{children}</div>
      </motion.div>
    </div>
  );
}
