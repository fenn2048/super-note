import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { Rocket, Sparkles, Coffee, Eye, Footprints } from "lucide-react";
import { useUserPreferences } from "@/hooks/useUserPreferences";

interface SpaceshipReminderProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SpaceshipReminder({ isOpen, onClose }: SpaceshipReminderProps) {
  const { prefs: userPrefs } = useUserPreferences();
  const intervalMinutes = userPrefs.reminderInterval;

  useEffect(() => {
    if (isOpen) {
      try {
        if ("vibrate" in navigator) {
          navigator.vibrate([100, 50, 100]);
        }
      } catch {}
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <style>{`
        @keyframes spaceshipFlyAcross {
          0% {
            left: -100px;
            transform: translateY(0) rotate(90deg);
          }
          10% {
            transform: translateY(-20px) rotate(92deg);
          }
          30% {
            transform: translateY(20px) rotate(88deg);
          }
          50% {
            transform: translateY(-15px) rotate(91deg);
          }
          70% {
            transform: translateY(15px) rotate(89deg);
          }
          90% {
            transform: translateY(-10px) rotate(90deg);
          }
          100% {
            left: calc(100vw + 100px);
            transform: translateY(0) rotate(90deg);
          }
        }

        .spaceship-animation-container {
          position: fixed;
          top: 25%;
          left: -100px;
          z-index: 9999;
          pointer-events: none;
          animation: spaceshipFlyAcross 6s cubic-bezier(0.25, 1, 0.5, 1) 3 forwards;
        }

        .exhaust-flame {
          position: absolute;
          left: -20px;
          top: 50%;
          transform: translateY(-50%);
          width: 20px;
          height: 8px;
          background: linear-gradient(to right, transparent, #ef4444, #f97316, #eab308);
          border-radius: 4px;
          filter: blur(1px);
          animation: flicker 0.15s infinite alternate;
        }

        @keyframes flicker {
          0% { transform: translateY(-50%) scaleY(1); opacity: 0.8; }
          100% { transform: translateY(-50%) scaleY(1.3); opacity: 1; }
        }
      `}</style>

      {/* Spaceship Flyer */}
      <div className="spaceship-animation-container">
        <div className="relative flex items-center">
          {/* Flame trail */}
          <div className="exhaust-flame" />
          {/* Rocket Icon */}
          <div className="w-16 h-16 text-indigo-500 dark:text-indigo-400 drop-shadow-[0_0_15px_rgba(99,102,241,0.75)]">
            <Rocket className="w-full h-full transform -rotate-45" />
          </div>
        </div>
      </div>

      {/* Reminder Card Modal Dialog */}
      <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative max-w-md w-full bg-white/80 dark:bg-zinc-900/80 border border-white/20 dark:border-zinc-800/20 backdrop-blur-xl rounded-2xl shadow-2xl p-6 overflow-hidden text-center"
        >
          {/* Decorative glow */}
          <div className="absolute -top-20 -left-20 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Icon Header */}
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-indigo-500/10 dark:bg-indigo-400/10 flex items-center justify-center text-indigo-500 dark:text-indigo-400 animate-bounce">
              <Sparkles className="w-8 h-8" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 mb-2">
            该休息一下啦！
          </h2>

          <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed mb-6">
            您已连续在此页面浏览超过 <span className="font-semibold text-indigo-600 dark:text-indigo-400">{intervalMinutes} 分钟</span>。为了您的健康，请注意以下几点：
          </p>

          {/* Advice items */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="flex flex-col items-center p-3 rounded-xl bg-zinc-50/50 dark:bg-zinc-800/30 border border-zinc-100/50 dark:border-zinc-800/50">
              <Eye className="w-6 h-6 text-emerald-500 mb-1.5" />
              <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">眨眨眼 / 远眺</span>
              <span className="text-[9px] text-zinc-400 mt-0.5">放松眼部肌肉</span>
            </div>
            <div className="flex flex-col items-center p-3 rounded-xl bg-zinc-50/50 dark:bg-zinc-800/30 border border-zinc-100/50 dark:border-zinc-800/50">
              <Coffee className="w-6 h-6 text-amber-500 mb-1.5" />
              <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">喝杯水</span>
              <span className="text-[9px] text-zinc-400 mt-0.5">补充身体水分</span>
            </div>
            <div className="flex flex-col items-center p-3 rounded-xl bg-zinc-50/50 dark:bg-zinc-800/30 border border-zinc-100/50 dark:border-zinc-800/50">
              <Footprints className="w-6 h-6 text-blue-500 mb-1.5" />
              <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">站立活动</span>
              <span className="text-[9px] text-zinc-400 mt-0.5">伸展肢体活动下</span>
            </div>
          </div>

          {/* Dismiss button */}
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 active:scale-[0.98] transition-all cursor-pointer"
          >
            好的，我会注意的
          </button>
        </motion.div>
      </div>
    </>
  );
}
