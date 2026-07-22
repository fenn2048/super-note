/**
 * 桌面 Web 扫码登录面板：出码 + 轮询
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Loader2, QrCode, RefreshCw, Smartphone } from "lucide-react";
import {
  encodeQrLoginPayload,
  qrCancel,
  qrCreate,
  qrStatus,
  type QrTicketStatus,
} from "@/lib/qrLogin";
import type { User } from "@/types";

interface Props {
  /** 当前桌面要登录的 API origin（无 /api） */
  serverUrl: string;
  onLogin: (token: string, user: User) => void;
}

type UiPhase = "loading" | "pending" | "scanned" | "expired" | "error";

export default function QrLoginPanel({ serverUrl, onLogin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ticketIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [phase, setPhase] = useState<UiPhase>("loading");
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [remainSec, setRemainSec] = useState(0);
  const [usernameMasked, setUsernameMasked] = useState("");

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const drawQr = useCallback(async (text: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    await QRCode.toCanvas(canvas, text, {
      width: 220,
      margin: 2,
      color: { dark: "#18181b", light: "#ffffff" },
      errorCorrectionLevel: "M",
    });
  }, []);

  const startSession = useCallback(async () => {
    stopPoll();
    setError("");
    setPhase("loading");
    setUsernameMasked("");
    try {
      // 作废旧 ticket
      if (ticketIdRef.current) {
        void qrCancel(ticketIdRef.current, serverUrl || undefined);
        ticketIdRef.current = null;
      }
      const created = await qrCreate(serverUrl || undefined);
      ticketIdRef.current = created.id;
      setExpiresAt(created.expiresAt);
      const payload = encodeQrLoginPayload(
        created.id,
        serverUrl || (typeof window !== "undefined" ? window.location.origin : ""),
      );
      await drawQr(payload);
      setPhase("pending");

      pollRef.current = setInterval(async () => {
        const id = ticketIdRef.current;
        if (!id) return;
        try {
          const st = await qrStatus(id, serverUrl || undefined);
          if (st.status === "scanned") {
            setPhase("scanned");
            if (st.usernameMasked) setUsernameMasked(st.usernameMasked);
          } else if (st.status === "confirmed" && st.token && st.user) {
            stopPoll();
            localStorage.setItem("super-token", st.token);
            onLogin(st.token, st.user as User);
          } else if (
            st.status === "expired" ||
            st.status === "cancelled" ||
            st.status === "consumed"
          ) {
            stopPoll();
            setPhase("expired");
          }
        } catch (e: any) {
          // 单次失败不打断
          console.warn("[qr-login] poll failed", e);
        }
      }, 1600);
    } catch (e: any) {
      setPhase("error");
      setError(e?.message || "无法生成二维码");
    }
  }, [serverUrl, drawQr, onLogin, stopPoll]);

  // 倒计时
  useEffect(() => {
    if (!expiresAt || (phase !== "pending" && phase !== "scanned")) {
      setRemainSec(0);
      return;
    }
    const tick = () => {
      const s = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemainSec(s);
      if (s <= 0) {
        setPhase("expired");
        stopPoll();
      }
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [expiresAt, phase, stopPoll]);

  useEffect(() => {
    void startSession();
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        stopPoll();
      } else if (phase === "pending" || phase === "scanned") {
        // 恢复轮询：简单重建
        void startSession();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopPoll();
      if (ticketIdRef.current) {
        void qrCancel(ticketIdRef.current, serverUrl || undefined);
      }
    };
    // 仅挂载时启动；serverUrl 变由用户刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  return (
    <div className="flex flex-col items-center py-2">
      <div className="relative w-[236px] h-[236px] rounded-2xl border border-app-border bg-white p-2 shadow-inner flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className={
            phase === "pending" || phase === "scanned" ? "rounded-xl" : "opacity-30"
          }
        />
        {(phase === "loading" || phase === "error" || phase === "expired") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 rounded-2xl gap-2 px-4 text-center">
            {phase === "loading" && (
              <>
                <Loader2 className="w-7 h-7 animate-spin text-accent-primary" />
                <p className="text-xs text-tx-tertiary">正在生成二维码…</p>
              </>
            )}
            {phase === "error" && (
              <>
                <p className="text-xs text-accent-danger">{error}</p>
                <button
                  type="button"
                  onClick={() => void startSession()}
                  className="mt-1 text-xs font-semibold text-accent-primary hover:underline"
                >
                  重试
                </button>
              </>
            )}
            {phase === "expired" && (
              <>
                <QrCode className="w-8 h-8 text-tx-tertiary" />
                <p className="text-xs text-tx-secondary">二维码已过期</p>
                <button
                  type="button"
                  onClick={() => void startSession()}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent-primary hover:underline"
                >
                  <RefreshCw size={12} /> 刷新二维码
                </button>
              </>
            )}
          </div>
        )}
        {phase === "scanned" && (
          <div className="absolute inset-x-2 bottom-2 rounded-lg bg-accent-primary/95 text-white text-[11px] font-medium py-1.5 px-2 text-center">
            {usernameMasked
              ? `${usernameMasked} 已扫码，请在手机上确认`
              : "已扫码，请在手机上确认"}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 max-w-[280px] text-center">
        <Smartphone className="w-4 h-4 text-tx-tertiary shrink-0 mt-0.5" />
        <p className="text-xs text-tx-tertiary leading-relaxed">
          打开已登录的蜉蝣 App → 我的 → 扫一扫，扫描此码即可登录桌面端
        </p>
      </div>

      {(phase === "pending" || phase === "scanned") && remainSec > 0 && (
        <p className="mt-2 text-[11px] text-tx-tertiary tabular-nums">
          {remainSec}s 后过期
          <button
            type="button"
            onClick={() => void startSession()}
            className="ml-2 text-accent-primary hover:underline"
          >
            刷新
          </button>
        </p>
      )}
    </div>
  );
}
