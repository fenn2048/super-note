/**
 * 移动端扫一扫：授权桌面 Web 登录
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, Monitor, X, AlertTriangle } from "lucide-react";
import {
  isSameServerAsQr,
  parseQrLoginPayload,
  qrConfirm,
  qrScan,
  type QrLoginPayload,
} from "@/lib/qrLogin";
import { getServerUrl } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Phase = "scanning" | "confirm" | "success" | "error";

export default function QrScanPage({ open, onClose }: Props) {
  const regionId = "qr-reader-region";
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const handledRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [payload, setPayload] = useState<QrLoginPayload | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverMismatch, setServerMismatch] = useState(false);

  const stopScanner = useCallback(async () => {
    try {
      await scannerRef.current?.stop();
    } catch {
      /* ignore */
    }
    scannerRef.current = null;
  }, []);

  const onDecoded = useCallback(
    async (text: string) => {
      if (handledRef.current) return;
      const parsed = parseQrLoginPayload(text);
      if (!parsed) {
        toast.error("无法识别的二维码");
        return;
      }
      handledRef.current = true;
      await stopScanner();

      const mismatch = !isSameServerAsQr(parsed.s);
      setServerMismatch(mismatch);
      setPayload(parsed);
      setPhase("confirm");

      if (!mismatch) {
        try {
          await qrScan(parsed.id, parsed.s);
        } catch {
          /* scan 登记失败不阻断确认 */
        }
      }
    },
    [stopScanner],
  );

  useEffect(() => {
    if (!open) return;
    handledRef.current = false;
    setPhase("scanning");
    setPayload(null);
    setError("");
    setServerMismatch(false);

    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(regionId);
        scannerRef.current = scanner as any;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 8,
            qrbox: { width: 240, height: 240 },
            aspectRatio: 1,
          },
          (decoded) => {
            void onDecoded(decoded);
          },
          () => {
            /* ignore frame miss */
          },
        );
      } catch (e: any) {
        console.error("[qr-scan] start failed", e);
        if (!cancelled) {
          setPhase("error");
          setError(
            e?.message?.includes("Permission") || e?.name === "NotAllowedError"
              ? "无法访问相机，请在系统设置中允许相机权限"
              : e?.message || "无法启动扫码，请检查相机权限",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      void stopScanner();
    };
  }, [open, onDecoded, stopScanner]);

  const handleConfirm = async () => {
    if (!payload || serverMismatch) return;
    setSubmitting(true);
    setError("");
    try {
      await qrConfirm(payload.id, payload.s);
      setPhase("success");
      toast.success("桌面端已登录");
      setTimeout(() => onClose(), 1200);
    } catch (e: any) {
      setError(e?.message || "确认失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-zinc-950 text-white"
      style={{
        paddingTop: "var(--safe-area-top)",
        paddingBottom: "var(--safe-area-bottom)",
      }}
    >
      <header className="flex items-center justify-between px-4 py-3 shrink-0">
        <button
          type="button"
          onClick={() => {
            void stopScanner();
            onClose();
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10"
          aria-label="关闭"
        >
          <X size={22} />
        </button>
        <h1 className="text-sm font-semibold">扫一扫</h1>
        <span className="w-10" />
      </header>

      {phase === "scanning" && (
        <div className="flex-1 flex flex-col min-h-0 px-4 pb-6">
          <div
            id={regionId}
            className="flex-1 min-h-[280px] rounded-2xl overflow-hidden bg-black border border-white/10"
          />
          <p className="mt-4 text-center text-xs text-white/60 leading-relaxed px-4">
            将桌面登录页的二维码放入框内，授权后桌面将自动登录
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Camera className="w-12 h-12 text-white/40" />
          <p className="text-sm text-white/80">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 px-5 py-2.5 rounded-xl bg-white/10 text-sm font-medium"
          >
            关闭
          </button>
        </div>
      )}

      {phase === "confirm" && payload && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
            <Monitor className="w-8 h-8 text-indigo-300" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-base font-semibold">确认登录桌面网页？</h2>
            <p className="text-xs text-white/55 leading-relaxed">
              服务器
              <br />
              <span className="text-white/85 font-mono text-[11px] break-all">{payload.s}</span>
            </p>
            {getServerUrl() && (
              <p className="text-[11px] text-white/40">
                当前 App 服务器：{getServerUrl()}
              </p>
            )}
          </div>

          {serverMismatch && (
            <div className="w-full max-w-sm flex items-start gap-2 rounded-xl bg-amber-500/15 border border-amber-400/30 px-3 py-2.5 text-left">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-100/90 leading-relaxed">
                二维码对应的服务器与当前 App 不一致，已拒绝授权。请在登录页连接同一服务器后再扫码。
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}

          <div className="w-full max-w-sm flex flex-col gap-2 mt-2">
            <button
              type="button"
              disabled={submitting || serverMismatch}
              onClick={() => void handleConfirm()}
              className={cn(
                "w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2",
                serverMismatch
                  ? "bg-white/10 text-white/40"
                  : "bg-indigo-500 hover:bg-indigo-400 text-white",
              )}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              确认登录
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/15"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {phase === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Check className="w-8 h-8 text-emerald-400" />
          </div>
          <p className="text-sm font-medium">授权成功，桌面端即将登录</p>
        </div>
      )}
    </div>
  );
}
