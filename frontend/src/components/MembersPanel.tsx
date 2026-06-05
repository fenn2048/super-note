/**
 * MembersPanel - 工作区成员与邀请管理面板（Phase 1）
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Trash2, Plus, UserPlus, Shield, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import {
  Workspace,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceRole,
  WorkspaceFeatures,
  WORKSPACE_FEATURE_META,
} from "@/types";
import { Modal } from "@/components/WorkspaceSwitcher";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { confirm as confirmDialog } from "@/components/ui/confirm";

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  commenter: "评论者",
  viewer: "查看者",
};

const ROLE_BADGE_CLASS: Record<WorkspaceRole, string> = {
  owner: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  admin: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  editor: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  commenter: "bg-green-500/20 text-green-600 dark:text-green-400",
  viewer: "bg-slate-500/20 text-slate-600 dark:text-slate-400",
};

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export default function MembersPanel({ workspaceId, onClose }: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [features, setFeatures] = useState<WorkspaceFeatures | null>(null);
  const [tab, setTab] = useState<"members" | "invites" | "features">("members");
  const [loading, setLoading] = useState(true);
  const [showCreateInvite, setShowCreateInvite] = useState(false);

  const isManager = workspace?.role === "owner" || workspace?.role === "admin";
  // 功能开关：按后端约束，仅 owner 可改；admin 可见但只读（保持信息透明）。
  const isOwner = workspace?.role === "owner";

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ws, mem] = await Promise.all([
        api.getWorkspace(workspaceId),
        api.getWorkspaceMembers(workspaceId),
      ]);
      setWorkspace(ws);
      setMembers(mem);
      // 只有管理员才能看邀请码
      if (ws.role === "owner" || ws.role === "admin") {
        try {
          const inv = await api.getWorkspaceInvites(workspaceId);
          setInvites(inv);
        } catch {
          // 忽略
        }
        // 功能开关：任何成员都能读（后端允许），但我们这里只在管理员视图里用。
        try {
          const feat = await api.getWorkspaceFeatures(workspaceId);
          setFeatures(feat);
        } catch {
          // 后端暂不可用时，降级为 null，Tab 显示 "加载失败" 即可，不阻断成员管理。
        }
      }
    } catch (e: any) {
      toast.error(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [workspaceId]);

  const handleRoleChange = async (userId: string, role: WorkspaceRole) => {
    try {
      await api.updateWorkspaceMember(workspaceId, userId, role);
      toast.success("角色已更新");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "更新失败");
    }
  };

  const handleRemove = async (userId: string, username: string) => {
    const ok = await confirmDialog({
      title: `确定要移除成员「${username}」吗？`,
      confirmText: "移除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeWorkspaceMember(workspaceId, userId);
      toast.success("已移除");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "移除失败");
    }
  };

  const handleDeleteInvite = async (inviteId: string) => {
    const ok = await confirmDialog({
      title: "确定要撤销这个邀请码吗？",
      confirmText: "撤销",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteWorkspaceInvite(workspaceId, inviteId);
      toast.success("邀请码已撤销");
      loadAll();
    } catch (e: any) {
      toast.error(e.message || "操作失败");
    }
  };

  // 功能开关：乐观更新 + 失败回滚。
  //   - owner 勾选时立即本地生效（侧边栏通过事件广播同步）
  //   - 后端失败则回滚 UI 并 toast
  //   - 广播自定义事件 'nowen:workspace-features-changed'，由侧边栏/路由守卫订阅
  const handleToggleFeature = async (key: keyof WorkspaceFeatures, value: boolean) => {
    if (!features || !isOwner) return;
    const prev = features;
    const next: WorkspaceFeatures = { ...features, [key]: value };
    setFeatures(next);
    try {
      const saved = await api.updateWorkspaceFeatures(workspaceId, { [key]: value });
      // 后端归一化结果为准，避免本地与服务端漂移
      setFeatures(saved);
      window.dispatchEvent(
        new CustomEvent("nowen:workspace-features-changed", {
          detail: { workspaceId, features: saved },
        }),
      );
    } catch (e: any) {
      setFeatures(prev);
      toast.error(e?.message || "保存失败");
    }
  };

  return (
    <Modal
      title={workspace ? `${workspace.icon} ${workspace.name}` : "工作区"}
      onClose={onClose}
      widthClass="max-w-2xl"
      heightClass="h-[80vh]"
    >
      {loading ? (
        <div className="py-8 text-center text-muted-foreground">加载中...</div>
      ) : (
        // 纵向填满 Modal body：tab 条固定在顶，面板区 flex-1 内部滚动，
        // 让弹窗整体高度稳定在 80vh，不再随 tab 内容伸缩。
        <div className="flex flex-col h-full min-h-0">
          {/* Tab */}
          <div className="flex gap-1 mb-4 border-b border-border shrink-0">
            <TabBtn active={tab === "members"} onClick={() => setTab("members")}>
              成员 ({members.length})
            </TabBtn>
            {isManager && (
              <TabBtn active={tab === "invites"} onClick={() => setTab("invites")}>
                邀请码 ({invites.length})
              </TabBtn>
            )}
            {isManager && (
              <TabBtn active={tab === "features"} onClick={() => setTab("features")}>
                功能模块
              </TabBtn>
            )}
          </div>

          {tab === "members" && (
            <div className="space-y-1 flex-1 min-h-0 overflow-auto">
              {members.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-3 p-2 rounded hover:bg-accent/50"
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold">
                    {m.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{m.username}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {m.email || "无邮箱"} · 加入于 {new Date(m.joinedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {isManager && m.role !== "owner" ? (
                    <RoleSelect
                      value={m.role}
                      onChange={(role) => handleRoleChange(m.userId, role)}
                    />
                  ) : (
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded text-xs font-medium",
                        ROLE_BADGE_CLASS[m.role],
                      )}
                    >
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                  {isManager && m.role !== "owner" && (
                    <button
                      onClick={() => handleRemove(m.userId, m.username)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                      title="移除成员"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "invites" && isManager && (
            <div className="flex flex-col flex-1 min-h-0 space-y-3">
              <div className="flex justify-end shrink-0">
                <Button size="sm" onClick={() => setShowCreateInvite(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  创建邀请码
                </Button>
              </div>
              <div className="space-y-2 flex-1 min-h-0 overflow-auto">
                {invites.length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-8">
                    暂无邀请码
                  </div>
                )}
                {invites.map((inv) => (
                  <InviteItem
                    key={inv.id}
                    invite={inv}
                    onDelete={() => handleDeleteInvite(inv.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {tab === "features" && isManager && (
            <div className="space-y-3 flex-1 min-h-0 overflow-auto">
              {!features ? (
                <div className="text-center text-sm text-muted-foreground py-8">
                  功能开关暂不可用
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    关闭的模块对所有成员隐藏入口，且无法读取/写入对应数据。
                    {!isOwner && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        仅所有者可修改。
                      </span>
                    )}
                  </p>
                  <div className="space-y-1">
                    {WORKSPACE_FEATURE_META.map((meta) => (
                      <FeatureRow
                        key={meta.key}
                        label={meta.label}
                        description={meta.description}
                        enabled={features[meta.key]}
                        disabled={!isOwner}
                        onToggle={(v) => handleToggleFeature(meta.key, v)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {showCreateInvite && (
        <CreateInviteDialog
          workspaceId={workspaceId}
          onClose={() => setShowCreateInvite(false)}
          onCreated={() => {
            setShowCreateInvite(false);
            loadAll();
          }}
        />
      )}
    </Modal>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-sm border-b-2 transition-colors -mb-px",
        active
          ? "border-primary text-primary font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: WorkspaceRole;
  onChange: (v: WorkspaceRole) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<
    { top: number; left: number; placement: "bottom" | "top" } | null
  >(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const options: WorkspaceRole[] = ["admin", "editor", "commenter", "viewer"];

  // 菜单尺寸（与下面 className 保持一致）：min-w 100、估高 ~ 4*28 + 8 padding ≈ 120
  const MENU_MIN_WIDTH = 100;
  const MENU_EST_HEIGHT = 120;

  const computePos = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const placement: "bottom" | "top" =
      spaceBelow < MENU_EST_HEIGHT + 12 && spaceAbove > spaceBelow ? "top" : "bottom";
    // 菜单右对齐按钮（与原 `right-0` 的视觉一致）
    const width = Math.max(MENU_MIN_WIDTH, rect.width);
    let left = rect.right - width;
    if (left < 8) left = 8;
    if (left + width > vw - 8) left = vw - width - 8;
    const top = placement === "bottom" ? rect.bottom + 4 : rect.top - 4 - MENU_EST_HEIGHT;
    setPos({ top, left, placement });
  };

  // 打开时定位；外点 / ESC / scroll / resize 自动关闭。
  // scroll 用 capture=true 能捕获任意祖先滚动容器（Modal body 滚动时直接关比跟随更稳）。
  useEffect(() => {
    if (!open) return;
    computePos();
    const handleDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleClose = () => setOpen(false);
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("touchstart", handleDown, { passive: true });
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("touchstart", handleDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1",
          ROLE_BADGE_CLASS[value],
        )}
      >
        {ROLE_LABEL[value]}
        <ChevronDown className="w-3 h-3" />
      </button>
      {/*
        菜单 portal 到 body，position:fixed + 按钮位置实时计算坐标。
        这样可以绕开 Modal 内容器的 overflow 裁切与 stacking context 限制，
        贴近视口底部时自动上翻，避免出现被"切半截"的现象。
      */}
      {open && pos &&
        createPortal(
          <AnimatePresence>
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: pos.placement === "bottom" ? -4 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: pos.placement === "bottom" ? -4 : 4 }}
              style={{ top: pos.top, left: pos.left, minWidth: MENU_MIN_WIDTH }}
              className="fixed z-[200] bg-popover border border-border rounded shadow-lg py-1"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {options.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    onChange(r);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </motion.div>
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

function InviteItem({
  invite,
  onDelete,
}: {
  invite: WorkspaceInvite;
  onDelete: () => void;
}) {
  const expired =
    !!invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
  const exhausted = invite.maxUses > 0 && invite.useCount >= invite.maxUses;
  const invalid = expired || exhausted;

  const copyCode = () => {
    navigator.clipboard.writeText(invite.code);
    toast.success("邀请码已复制");
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded border border-border",
        invalid && "opacity-60",
      )}
    >
      <code
        className={cn(
          "px-2 py-1 rounded font-mono text-sm cursor-pointer bg-muted hover:bg-accent",
        )}
        onClick={copyCode}
        title="点击复制"
      >
        {invite.code}
      </code>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <div>
          角色：<span className="font-medium text-foreground">{ROLE_LABEL[invite.role]}</span>
          {" · "}
          使用 {invite.useCount}/{invite.maxUses || "∞"}
        </div>
        <div>
          {invite.expiresAt
            ? `有效期至 ${new Date(invite.expiresAt).toLocaleString()}`
            : "永久有效"}
          {expired && <span className="text-destructive ml-2">已过期</span>}
          {exhausted && <span className="text-destructive ml-2">已用尽</span>}
        </div>
      </div>
      <button
        onClick={copyCode}
        className="p-1.5 rounded hover:bg-accent"
        title="复制"
      >
        <Copy className="w-4 h-4" />
      </button>
      <button
        onClick={onDelete}
        className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
        title="撤销"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ========== 功能开关行（Phase 1）========== */
function FeatureRow({
  label,
  description,
  enabled,
  disabled,
  onToggle,
}: {
  label: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded border border-border",
        disabled && "opacity-80",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {/* 纯 CSS toggle，不引额外组件库。disabled 下 onClick 不响应，且鼠标样式提示。 */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => !disabled && onToggle(!enabled)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          enabled ? "bg-primary" : "bg-muted",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
        title={disabled ? "仅所有者可修改" : undefined}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform",
            enabled && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}

/* ========== 创建邀请码对话框 ========== */
function CreateInviteDialog({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [maxUses, setMaxUses] = useState(10);
  const [expireDays, setExpireDays] = useState(7);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const expiresAt =
        expireDays > 0
          ? new Date(Date.now() + expireDays * 24 * 3600 * 1000).toISOString()
          : undefined;
      await api.createWorkspaceInvite(workspaceId, {
        role,
        maxUses: maxUses || 10,
        expiresAt,
      });
      toast.success("邀请码已生成");
      onCreated();
    } catch (e: any) {
      toast.error(e.message || "创建失败");
    } finally {
      setLoading(false);
    }
  };

  const roleOptions: WorkspaceRole[] = ["admin", "editor", "commenter", "viewer"];

  return (
    <Modal title="创建邀请码" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-sm mb-1 block">角色</label>
          <div className="flex gap-2 flex-wrap">
            {roleOptions.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "px-3 py-1 rounded text-sm border transition-colors",
                  role === r
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-accent",
                )}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm mb-1 block">最大使用次数</label>
          <Input
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(parseInt(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="text-sm mb-1 block">有效期（天）</label>
          <Input
            type="number"
            min={0}
            value={expireDays}
            onChange={(e) => setExpireDays(parseInt(e.target.value) || 0)}
            placeholder="0 表示永久"
          />
          <p className="text-xs text-muted-foreground mt-1">0 表示永久有效</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "创建中..." : "生成邀请码"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
