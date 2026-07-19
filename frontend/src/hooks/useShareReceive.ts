/**
 * 登录后处理 Android 系统分享入站（挂在 AppLayout）
 * 未登录暂存由 AuthGate 负责。
 */
import { useEffect, useRef } from "react";
import { isNativePlatform } from "@/hooks/useCapacitor";
import {
  clearStashedShare,
  peekStashedShare,
  processSharePayload,
  stashSharePayload,
  subscribeShareReceive,
  type SharePayload,
} from "@/lib/shareReceive";
import { toast } from "@/lib/toast";

export function useShareReceive(opts: {
  authenticated: boolean;
  onNoteCreated?: (noteId: string) => void;
}) {
  const { authenticated, onNoteCreated } = opts;
  const processing = useRef(false);
  const lastFingerprint = useRef<string>("");
  const onNoteCreatedRef = useRef(onNoteCreated);
  onNoteCreatedRef.current = onNoteCreated;
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;

  const fingerprint = (p: SharePayload) =>
    `${p.type}|${p.url || ""}|${(p.text || "").slice(0, 80)}|${p.images?.length || 0}|${p.files?.length || 0}`;

  const run = async (payload: SharePayload) => {
    if (!authenticatedRef.current) {
      stashSharePayload(payload);
      return;
    }

    const fp = fingerprint(payload);
    if (processing.current) {
      if (fp !== lastFingerprint.current) stashSharePayload(payload);
      return;
    }
    // 短时去重：冷启动 consume + 事件可能双发同一份
    if (fp === lastFingerprint.current) return;
    lastFingerprint.current = fp;
    processing.current = true;

    const loadingId = toast.info("正在保存分享内容…", 0);
    try {
      const result = await processSharePayload(payload);
      toast.dismiss(loadingId);
      clearStashedShare();
      if (result?.noteId) {
        toast.success(`已保存：${result.title}`);
        onNoteCreatedRef.current?.(result.noteId);
      } else {
        toast.warning("未能识别分享内容");
      }
    } catch (e: any) {
      toast.dismiss(loadingId);
      toast.error(e?.message || "保存分享失败");
      stashSharePayload(payload);
      lastFingerprint.current = "";
    } finally {
      processing.current = false;
      const next = peekStashedShare();
      if (next && fingerprint(next) !== fp) {
        void run(next);
      }
    }
  };

  useEffect(() => {
    if (!isNativePlatform()) return;
    return subscribeShareReceive((payload) => {
      void run(payload);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const stashed = peekStashedShare();
    if (stashed) {
      const t = window.setTimeout(() => void run(stashed), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);
}
