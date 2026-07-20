import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Clock, Calendar } from "lucide-react";
import { getCustomScreensaverDataUrl } from "@/lib/splashStorage";
import { getBaseUrl } from "@/lib/api";

interface BrowserScreensaverProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BrowserScreensaver({ isOpen, onClose }: BrowserScreensaverProps) {
  const [time, setTime] = useState<Date>(new Date());
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  // 1. Clock timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. 背景：优先本机自定义屏保图（不上云）→ Bing
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const local = await getCustomScreensaverDataUrl();
        if (cancelled) return;
        if (local) {
          setBgUrl(local);
          return;
        }
      } catch { /* ignore */ }
      if (!cancelled) {
        // 走后端代理的 Bing 壁纸（需要服务端）
        setBgUrl(`${getBaseUrl()}/media/screensaver/bing`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // 3. Auto-save on mount, and any keydown to close screensaver
  useEffect(() => {
    if (isOpen) {
      window.dispatchEvent(new CustomEvent("super:save-all"));

      const handleKeyPress = () => {
        onClose();
      };
      window.addEventListener("keydown", handleKeyPress);
      window.addEventListener("mousedown", handleKeyPress);

      return () => {
        window.removeEventListener("keydown", handleKeyPress);
        window.removeEventListener("mousedown", handleKeyPress);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const timeString = time.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const dateString = time.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden bg-black select-none">
      <motion.div
        initial={{ scale: 1.05, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
        className="absolute inset-0 w-full h-full"
      >
        {bgUrl && (
          <motion.img
            src={bgUrl}
            alt="Screensaver"
            className="w-full h-full object-cover"
            initial={{ scale: 1 }}
            animate={{ scale: 1.08 }}
            transition={{
              duration: 60,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "linear",
            }}
            onError={(e) => {
              // Bing 失败时保持黑底
              e.currentTarget.style.display = "none";
            }}
          />
        )}
      </motion.div>

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/75 backdrop-blur-[1px]" />

      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute z-50 p-2.5 rounded-full bg-black/40 hover:bg-black/75 border border-white/10 hover:border-white/20 text-white/70 hover:text-white transition-all shadow-lg hover:scale-105"
        style={{
          top: "calc(var(--safe-area-top, 0px) + 16px)",
          right: 16,
        }}
        title="关闭屏保"
      >
        <X size={20} />
      </button>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 pointer-events-none">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.8 }}
          className="flex flex-col items-center gap-4 bg-black/25 backdrop-blur-md p-10 rounded-3xl border border-white/5 shadow-2xl"
        >
          <div className="flex items-center gap-3 text-white/50 text-xs font-semibold uppercase tracking-widest mb-1">
            <Clock size={14} className="text-accent-primary animate-pulse" />
            <span>智能时钟屏保</span>
          </div>

          <h1 className="text-6xl md:text-8xl font-black text-white tracking-wider font-mono drop-shadow-md select-none">
            {timeString}
          </h1>

          <div className="flex items-center gap-2 text-sm md:text-base text-white/80 font-medium tracking-wide mt-2">
            <Calendar size={15} className="text-accent-primary" />
            <span>{dateString}</span>
          </div>
        </motion.div>
      </div>

      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 text-[11px] text-white/40 tracking-wider pointer-events-none font-medium">
        按任意键或点击关闭屏保
      </div>
    </div>
  );
}
