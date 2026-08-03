/**
 * WorkspaceSwitcher - 工作区切换器
 *
 * 功能：
 *   - 下拉列出当前用户的所有工作区
 *   - 切换后触发全局数据重载
 *   - 快捷入口：创建工作区、加入工作区（输入邀请码）
 *   - 管理成员入口
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  ChevronDown,
  Users,
  LogIn,
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
import { AppModal } from "@/components/common/AppModal";
import { springs } from "@/lib/motion";

/** 兼容旧 import：统一走 AppModal（portal + app token），避免 MembersPanel 循环依赖与空白弹窗 */
export { AppModal as Modal } from "@/components/common/AppModal";

interface WorkspaceSwitcherProps {
  /** 切换后父组件触发的回调，通常是 reload 数据 */
  onWorkspaceChange?: (workspaceId: string) => void;
  collapsed?: boolean;
  variant?: "sidebar" | "header";
}

export default function WorkspaceSwitcher({ onWorkspaceChange, collapsed, variant = "sidebar" }: WorkspaceSwitcherProps) {
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
  const menuPanelRef = useRef<HTMLDivElement>(null);
  /** header 变体：下拉 portal 到 body，避免被 MobileChromeHeader overflow-hidden 裁切 */
  const [headerMenuPos, setHeaderMenuPos] = useState<{
    top: number;
    right: number;
    width: number;
  } | null>(null);
  const { menu, menuRef, openMenu, closeMenu } = useContextMenu();

  const loadWorkspaces = async (opts?: { autoSelect?: boolean }) => {
    const autoSelect = opts?.autoSelect !== false;
    try {
      const list = await api.getWorkspaces();
      setWorkspaces(list);
      // 有工作区但未选中 / 选中 id 已失效 → 自动选第一个
      if (autoSelect && list.length > 0) {
        const stored = getCurrentWorkspace();
        const valid = stored && list.some((w) => w.id === stored);
        if (!valid) {
          const nextId = list[0].id;
          setCurrent(nextId);
          setCurrentWorkspace(nextId);
          onWorkspaceChange?.(nextId);
          window.dispatchEvent(
            new CustomEvent("super:workspace-changed", {
              detail: { workspaceId: nextId },
            }),
          );
        } else {
          setCurrent(stored);
        }
      }
    } catch (e: any) {
      console.error("[WorkspaceSwitcher] load failed", e);
    }
  };

  useEffect(() => {
    void loadWorkspaces({ autoSelect: true });
    // 外部切换（App 自动选中、FirstRunWizard 等）时同步按钮展示；不再次 autoSelect 避免环
    const onExternal = (e: Event) => {
      const id = (e as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
      if (typeof id === "string") {
        setCurrent(id || getCurrentWorkspace());
      } else {
        setCurrent(getCurrentWorkspace());
      }
      void loadWorkspaces({ autoSelect: false });
    };
    window.addEventListener("super:workspace-changed", onExternal);
    return () => window.removeEventListener("super:workspace-changed", onExternal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
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

  // header 下拉：按触发按钮定位到 viewport（fixed + portal）
  useLayoutEffect(() => {
    if (!open || variant !== "header") {
      setHeaderMenuPos(null);
      return;
    }
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setHeaderMenuPos({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
        width: Math.max(r.width, 180),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, variant]);

  // 点击外部关闭下拉（含 portal 面板）
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (menuPanelRef.current?.contains(t)) return;
      setOpen(false);
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
    window.dispatchEvent(new CustomEvent("super:workspace-changed", { detail: { workspaceId: id } }));
  };

  const currentWs = workspaces.find((w) => w.id === current);
  const displayName = currentWs?.name || "";
  const displayIcon = currentWs?.icon || "🏢";

  const getRoleLabel = (role?: string) => {
    const roles: Record<string, string> = {
      owner: t("workspace.roles.owner"),
      admin: t("workspace.roles.admin"),
      editor: t("workspace.roles.editor"),
      commenter: t("workspace.roles.commenter"),
      viewer: t("workspace.roles.viewer"),
    };
    return role ? (roles[role] || role) : "";
  };

  const renderWorkspaceMenuBody = () => (
    <>
      <div className="max-h-[min(320px,50vh)] overflow-auto py-1">
        {workspaces.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            {t("workspace.noWorkspaces") || "暂无工作区"}
          </div>
        )}
        {workspaces.map((w) => (
          <WorkspaceItem
            key={w.id}
            icon={w.icon || "🏢"}
            name={w.name}
            subtitle={`${getRoleLabel(w.role)} · ${t("workspaceManagement.members", { count: w.memberCount })}`}
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
          type="button"
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent"
          onClick={() => {
            setOpen(false);
            setShowCreate(true);
          }}
        >
          <Plus className="w-4 h-4" />
          {t("workspace.create")}
        </button>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent"
          onClick={() => {
            setOpen(false);
            setShowJoin(true);
          }}
        >
          <LogIn className="w-4 h-4" />
          {t("workspace.join")}
        </button>
      </div>
    </>
  );

  // 在入口按钮（展开/收起态）上右键当前工作区时，直接弹出对应右键菜单。
  const handleEntryContextMenu = (e: React.MouseEvent) => {
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
              window.dispatchEvent(new CustomEvent("super:workspace-changed", { detail: { workspaceId: current } }));
            }}
          />
        )}
        {deleting && (
          <DeleteWorkspaceDialog
            workspace={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={async () => {
              const removedId = deleting.id;
              setDeleting(null);
              const remaining = await api.getWorkspaces();
              if (current === removedId) {
                if (remaining.length > 0) {
                  const next = remaining[0];
                  setCurrent(next.id);
                  setCurrentWorkspace(next.id);
                  onWorkspaceChange?.(next.id);
                  window.dispatchEvent(
                    new CustomEvent("super:workspace-changed", {
                      detail: { workspaceId: next.id },
                    }),
                  );
                } else {
                  localStorage.removeItem("super-current-workspace");
                  window.dispatchEvent(
                    new CustomEvent("super:workspace-changed", {
                      detail: { workspaceId: "" },
                    }),
                  );
                }
              }
              setWorkspaces(remaining);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div ref={ref} className="relative">
        {variant === "header" ? (
          <button
            onClick={() => setOpen((v) => !v)}
            onContextMenu={handleEntryContextMenu}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-app-border bg-app-surface hover:bg-app-hover active:scale-95 transition-transform duration-press ease-out text-xs font-semibold text-tx-primary shrink-0"
          >
            <span>{displayIcon} {displayName || "选择工作区"}</span>
            <ChevronDown size={14} className={cn("transition-transform duration-200", open && "rotate-180")} />
          </button>
        ) : (
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
                  {getRoleLabel(currentWs.role)} · {t("workspaceManagement.members", { count: currentWs.memberCount })}
                </div>
              )}
            </div>
            <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
          </button>
        )}

        {/* sidebar：相对定位下拉；header：portal 到 body，避免顶栏 overflow-hidden 裁切 */}
        {variant !== "header" && (
          <AnimatePresence>
            {open && (
              <motion.div
                ref={menuPanelRef}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={springs.snappy}
                className="absolute top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
              >
                {renderWorkspaceMenuBody()}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {variant === "header" &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && headerMenuPos && (
              <motion.div
                ref={menuPanelRef}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={springs.snappy}
                className="fixed bg-popover border border-border rounded-lg shadow-xl z-[200] overflow-hidden"
                style={{
                  top: headerMenuPos.top,
                  right: headerMenuPos.right,
                  width: headerMenuPos.width,
                  maxWidth: "min(280px, calc(100vw - 16px))",
                }}
              >
                {renderWorkspaceMenuBody()}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

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
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("🏢");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("workspace.enterName"));
      return;
    }
    setLoading(true);
    try {
      const ws = await api.createWorkspace({ name: name.trim(), description, icon });
      toast.success(t("workspace.createSuccess"));
      onCreated(ws);
    } catch (e: any) {
      toast.error(e.message || t("userManagement.createFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={t("workspace.create")} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-sm mb-1 block">{t("workspaceManagement.fieldIcon")}</label>
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
            {t("workspaceManagement.fieldName")} <span className="text-destructive">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("workspaceManagement.fieldName")}
            autoFocus
          />
        </div>
        <div>
          <label className="text-sm mb-1 block">{t("workspaceManagement.fieldDescription")}</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("workspaceManagement.fieldDescription")}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? t("common.saving") : t("workspaceManagement.save")}
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
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!code.trim()) {
      toast.error(t("workspace.enterInviteCode"));
      return;
    }
    setLoading(true);
    try {
      const res = await api.joinWorkspace(code.trim());
      if (res.alreadyMember) {
        toast.info(t("workspace.alreadyMember"));
        onJoined(res.workspaceId!);
      } else {
        toast.success(t("workspace.joinSuccess", { name: res.workspace?.name }));
        onJoined(res.workspace!.id);
      }
    } catch (e: any) {
      toast.error(e.message || t("workspace.joinFailed", { defaultValue: "加入失败" }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={t("workspace.join")} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-sm mb-1 block">{t("workspace.members.invites")}</label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t("workspace.joinPlaceholder")}
            autoFocus
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">{t("workspace.joinHint")}</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleJoin} disabled={loading}>
            {loading ? t("common.loading") : t("workspace.members.generateInvite")}
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
      toast.error(t("workspace.enterName"));
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
      toast.success(t("workspaceManagement.deleteSuccess"));
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message || t("workspaceManagement.deleteFailed"));
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t("workspaceManagement.deleteTitle", {
        name: workspace.name,
      })}
      onClose={() => !loading && onClose()}
    >
      <div className="space-y-4 text-sm">
        <div className="p-3 rounded-lg bg-red-50/60 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
            {t("workspaceManagement.deleteConfirmHintNoOwner")}
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

/* ========== 通用 Modal（本地别名，与 re-export 同源） ========== */
const Modal = AppModal;
