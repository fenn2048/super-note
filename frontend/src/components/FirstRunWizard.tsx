import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, Loader2, LogIn, Check,
} from "lucide-react";
import { api, setCurrentWorkspace } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/BrandMark";
import { MODULE_PACK_META, setModulePack, type ModulePackId } from "@/lib/modulePack";

interface FirstRunWizardProps {
  onComplete: () => void;
}

export default function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const [pack, setPack] = useState<ModulePackId>("family");
  const [creating, setCreating] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const handleCreateFamily = useCallback(async () => {
    setCreating(true);
    try {
      const ws = await api.createWorkspace({
        name: "我的家庭",
        description: "一家人共享的笔记、说说和待办空间",
        icon: "🏠",
      });
      setCurrentWorkspace(ws.id);
      window.dispatchEvent(new CustomEvent("super:workspace-changed", { detail: { workspaceId: ws.id } }));
      setModulePack(pack);
      toast.success("家庭空间创建成功！");
      onComplete();
    } catch (e: any) {
      toast.error(e?.message || "创建失败");
    } finally {
      setCreating(false);
    }
  }, [onComplete, pack]);

  const handleJoin = useCallback(async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    try {
      const result = await api.joinWorkspace(joinCode.trim());
      if (!result.workspaceId) {
        toast.error("加入失败：无效的邀请码");
        setJoining(false);
        return;
      }
      setCurrentWorkspace(result.workspaceId);
      window.dispatchEvent(new CustomEvent("super:workspace-changed", { detail: { workspaceId: result.workspaceId } }));
      setModulePack(pack);
      toast.success("已加入空间！");
      onComplete();
    } catch (e: any) {
      toast.error(e?.message || "加入失败");
    } finally {
      setJoining(false);
    }
  }, [joinCode, onComplete, pack]);

  return (
    <div className="fixed inset-0 z-[200] bg-app-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-app-elevated rounded-3xl shadow-2xl border border-app-border w-full max-w-[420px] overflow-hidden p-8 text-center"
      >
        <div className="flex justify-center mb-4">
          <BrandMark size={72} />
        </div>
        <h1 className="text-xl font-bold text-tx-primary mb-2">欢迎来到 蜉蝣</h1>
        <p className="text-sm text-tx-secondary mb-6 leading-relaxed">
          创建或加入一个家庭空间，与家人一起使用笔记、说说、待办、思维导图等功能。
        </p>

        <div className="grid grid-cols-2 gap-2 mb-5 text-left">
          {MODULE_PACK_META.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setPack(m.id)}
              className={`rounded-xl border px-3 py-2.5 transition-colors ${
                pack === m.id
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-app-border hover:border-app-border/80"
              }`}
            >
              <div className="text-xs font-semibold text-tx-primary">
                {m.label}
                {m.recommended ? " · 推荐" : ""}
              </div>
              <div className="text-[10px] text-tx-tertiary mt-0.5 leading-snug">{m.description}</div>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => { setModulePack(pack); onComplete(); }}
            className="w-full py-2.5 rounded-xl text-sm font-medium border border-app-border text-tx-secondary hover:bg-app-hover"
          >
            仅个人使用，跳过家庭空间
          </button>
          <button
            onClick={handleCreateFamily}
            disabled={creating}
            className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {creating ? "创建中..." : "创建家庭空间"}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-app-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-app-elevated px-2 text-tx-tertiary">或</span>
            </div>
          </div>

          {!showJoin ? (
            <button
              onClick={() => setShowJoin(true)}
              className="w-full py-3 rounded-xl text-sm font-medium border border-app-border text-tx-primary hover:bg-app-hover transition-all flex items-center justify-center gap-2"
            >
              <LogIn size={16} />
              加入已有空间
            </button>
          ) : (
            <div className="space-y-2">
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="输入邀请码"
                className="text-center text-lg tracking-widest"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowJoin(false)}
                  className="flex-1"
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={handleJoin}
                  disabled={joining || !joinCode.trim()}
                  className="flex-1"
                >
                  {joining ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  加入
                </Button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
