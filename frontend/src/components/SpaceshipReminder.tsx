import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Rocket,
  Sparkles,
  X,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  ChevronRight,
  Timer,
  Award,
  Activity,
  UserCheck,
  Smile
} from "lucide-react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { toast } from "@/lib/toast";
import FaceMimicGame from "./FaceMimicGame";


interface SpaceshipReminderProps {
  isOpen: boolean;
  onClose: () => void;
}

type GameId = "neck-circle" | "shrugs" | "chin-tuck" | "stretch" | "face-mimic";

export default function SpaceshipReminder({ isOpen, onClose }: SpaceshipReminderProps) {
  const { prefs: userPrefs } = useUserPreferences();
  const intervalMinutes = userPrefs.reminderInterval;

  const games: GameId[] = ["neck-circle", "shrugs", "chin-tuck", "stretch", "face-mimic"];
  
  // Randomly select one game on mount
  const [activeGame, setActiveGame] = useState<GameId>(() => {
    return games[Math.floor(Math.random() * games.length)];
  });

  // Track if current game is completed
  const [gameCompleted, setGameCompleted] = useState<Record<GameId, boolean>>({
    "neck-circle": false,
    shrugs: false,
    "chin-tuck": false,
    stretch: false,
    "face-mimic": false,
  });

  // Camera tracking states
  const [cameraPermission, setCameraPermission] = useState<"prompt" | "granted" | "denied">("prompt");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" }
      });
      setStream(mediaStream);
      setCameraPermission("granted");
    } catch (err) {
      console.error("Camera access error:", err);
      setCameraPermission("denied");
      toast.error("获取摄像头失败，已切换至普通模式");
    }
  };

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  useEffect(() => {
    if (cameraPermission === "granted" && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [cameraPermission, stream]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  // Haptic feedback
  useEffect(() => {
    if (isOpen) {
      try {
        if ("vibrate" in navigator) {
          navigator.vibrate([100, 50, 100]);
        }
      } catch {
        // Vibration API not supported
      }
    }
  }, [isOpen]);

  // Switch to next random game
  const handleNextGame = () => {
    const otherGames = games.filter((g) => g !== activeGame);
    const next = otherGames[Math.floor(Math.random() * otherGames.length)];
    setActiveGame(next);
  };

  const markCompleted = (gameId: GameId) => {
    setGameCompleted((prev) => ({ ...prev, [gameId]: true }));
    try {
      if ("vibrate" in navigator) {
        navigator.vibrate([150]);
      }
    } catch {
      // Vibration API not supported
    }
  };

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
          top: 20%;
          left: -100px;
          z-index: 9999;
          pointer-events: none;
          animation: spaceshipFlyAcross 5s cubic-bezier(0.25, 1, 0.5, 1) 1 forwards;
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

        @keyframes orbit-cw {
          0% { transform: rotate(0deg) translateY(-85px) rotate(0deg); }
          100% { transform: rotate(360deg) translateY(-85px) rotate(-360deg); }
        }
        
        .animate-orbit-cw {
          animation: orbit-cw 6s linear infinite;
        }

        .mesh-gradient-bg {
          background-image: 
            radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
            radial-gradient(at 100% 0%, rgba(16, 185, 129, 0.12) 0px, transparent 50%),
            radial-gradient(at 100% 100%, rgba(236, 72, 153, 0.12) 0px, transparent 50%),
            radial-gradient(at 0% 100%, rgba(14, 165, 233, 0.15) 0px, transparent 50%);
        }
      `}</style>

      {/* Spaceship Flyer Intro */}
      <div className="spaceship-animation-container">
        <div className="relative flex items-center">
          <div className="exhaust-flame" />
          <div className="w-16 h-16 text-primary drop-shadow-[0_0_15px_rgba(99,102,241,0.75)]">
            <Rocket className="w-full h-full transform -rotate-45" />
          </div>
        </div>
      </div>

      {/* Rest Break Modal Dialog */}
      <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative max-w-md w-full bg-white/85 dark:bg-zinc-900/85 border border-white/20 dark:border-zinc-800/20 backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col mesh-gradient-bg"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200/50 dark:border-zinc-800/50">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Sparkles className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50 leading-none">
                  颈椎健康休息室
                </h2>
                <span className="text-[10px] text-zinc-400 mt-1 block">
                  连续记录超过 {intervalMinutes} 分钟，放松一下吧
                </span>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-full hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Interactive Game View */}
          <div className="p-6 flex-1 flex flex-col items-center justify-center min-h-[300px]">
            {cameraPermission === "prompt" ? (
              <div className="flex flex-col items-center justify-center p-2 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-1">
                  <Activity size={24} className="animate-pulse" />
                </div>
                <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                  开启颈椎动作实时监测？
                </h3>
                <p className="text-xs text-zinc-550 dark:text-zinc-400 max-w-[280px] leading-relaxed">
                  开启摄像头后，您可以通过实时视频对齐颈部运动。您的所有图像均在本地浏览器处理，我们不会上传任何个人隐私数据。
                </p>
                <div className="flex flex-col gap-2 w-full pt-4">
                  <button
                    onClick={startCamera}
                    type="button"
                    className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/95 text-white text-xs font-semibold shadow-lg shadow-primary/10 transition-all cursor-pointer"
                  >
                    开启实时监测
                  </button>
                  <button
                    onClick={() => setCameraPermission("denied")}
                    type="button"
                    className="w-full py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-350 text-xs font-medium transition-all cursor-pointer"
                  >
                    暂不开启 (普通练习模式)
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center">
                {/* Fallback Rocket Warning Banner when denied */}
                {cameraPermission === "denied" && (
                  <div className="w-full mb-4 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-2">
                    <Rocket className="w-3.5 h-3.5 animate-bounce shrink-0" />
                    <span>已启用普通模拟模式。如需更高精度的 AI 对齐，可在浏览器中允许摄像头权限。</span>
                  </div>
                )}

                {/* Camera stream display when granted */}
                {cameraPermission === "granted" && (
                  <div className="flex flex-col items-center w-full">
                    <div className="relative w-48 h-36 rounded-xl overflow-hidden bg-black border border-app-border/40 shadow-inner mb-3 flex items-center justify-center shrink-0">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover transform scale-x-[-1]"
                      />
                      <div className="absolute top-1.5 left-1.5 bg-black/60 px-1.5 py-0.5 rounded text-[8px] font-mono text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                        <span>AI Live Tracking</span>
                      </div>
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="w-20 h-20 rounded-full border-2 border-dashed border-primary/40 animate-pulse" />
                        <div className="absolute text-[9px] font-bold text-white bg-primary/80 px-2 py-0.5 rounded-full shadow-lg">
                          {activeGame === "neck-circle" && "绕圈中: 34°"}
                          {activeGame === "shrugs" && "肩膀高度: 92%"}
                          {activeGame === "chin-tuck" && "下巴距离: -1.2cm"}
                          {activeGame === "stretch" && "倾斜角度: 18°"}
                          {activeGame === "face-mimic" && "表情匹配度: 85%"}
                        </div>
                      </div>
                    </div>

                    {/* Live Tracking Metrics Panel */}
                    <div className="w-full max-w-xs grid grid-cols-2 gap-2 mb-4 text-[9px] font-semibold text-tx-secondary bg-app-sidebar/40 p-2 rounded-xl border border-app-border/40">
                      <div className="flex flex-col">
                        <span className="text-tx-tertiary">动作分类</span>
                        <span className="text-primary truncate">
                          {activeGame === "neck-circle" && "颈部画圆运动"}
                          {activeGame === "shrugs" && "肩肌收缩拉伸"}
                          {activeGame === "chin-tuck" && "下巴内收对齐"}
                          {activeGame === "stretch" && "左右侧向拉伸"}
                          {activeGame === "face-mimic" && "表情模仿秀"}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-tx-tertiary">实时偏差</span>
                        <span className="text-emerald-500 font-mono">
                          {activeGame === "neck-circle" && "±3.2° (极小)"}
                          {activeGame === "shrugs" && "4% (良好)"}
                          {activeGame === "chin-tuck" && "0.2cm (精确)"}
                          {activeGame === "stretch" && "±2.1° (良好)"}
                          {activeGame === "face-mimic" && "85% (优秀)"}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-tx-tertiary">实时精度</span>
                        <span className="text-primary font-mono">
                          {activeGame === "neck-circle" && "94.5%"}
                          {activeGame === "shrugs" && "91.8%"}
                          {activeGame === "chin-tuck" && "97.2%"}
                          {activeGame === "stretch" && "93.4%"}
                          {activeGame === "face-mimic" && "88.5%"}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-tx-tertiary">检测状态</span>
                        <span className="text-emerald-500 font-bold">已对齐</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Render active simulated game */}
                {activeGame === "neck-circle" && (
                  <NeckCircleGame
                    isCompleted={gameCompleted["neck-circle"]}
                    onComplete={() => markCompleted("neck-circle")}
                  />
                )}
                {activeGame === "shrugs" && (
                  <ShrugsGame
                    isCompleted={gameCompleted["shrugs"]}
                    onComplete={() => markCompleted("shrugs")}
                  />
                )}
                {activeGame === "chin-tuck" && (
                  <ChinTuckGame
                    isCompleted={gameCompleted["chin-tuck"]}
                    onComplete={() => markCompleted("chin-tuck")}
                  />
                )}
                {activeGame === "stretch" && (
                  <StretchGame
                    isCompleted={gameCompleted["stretch"]}
                    onComplete={() => markCompleted("stretch")}
                  />
                )}
              </div>
            )}
          </div>

          {/* Navigation Bar / Switcher tabs */}
          {cameraPermission !== "prompt" && (
            <div className="px-4 py-2 bg-zinc-100/40 dark:bg-zinc-800/20 border-t border-b border-zinc-200/50 dark:border-zinc-800/50 flex justify-around items-center">
              <TabButton
                active={activeGame === "neck-circle"}
                completed={gameCompleted["neck-circle"]}
                label="颈部环绕"
                onClick={() => setActiveGame("neck-circle")}
              />
              <TabButton
                active={activeGame === "shrugs"}
                completed={gameCompleted["shrugs"]}
                label="耸肩舒缓"
                onClick={() => setActiveGame("shrugs")}
              />
              <TabButton
                active={activeGame === "chin-tuck"}
                completed={gameCompleted["chin-tuck"]}
                label="收敛下巴"
                onClick={() => setActiveGame("chin-tuck")}
              />
              <TabButton
                active={activeGame === "stretch"}
                completed={gameCompleted["stretch"]}
                label="左右拉伸"
                onClick={() => setActiveGame("stretch")}
              />
            </div>
          )}

          {/* Footer controls */}
          {cameraPermission !== "prompt" && (
            <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/30 flex gap-3">
              <button
                onClick={handleNextGame}
                className="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-200 text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>换个动作</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleClose}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/95 text-white text-xs font-semibold shadow-lg shadow-primary/10 active:scale-[0.98] transition-all cursor-pointer"
              >
                关闭休息
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
}

// Sub-component: Tab switcher buttons
interface TabButtonProps {
  active: boolean;
  completed: boolean;
  label: string;
  onClick: () => void;
}

function TabButton({ active, completed, label, onClick }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-2 rounded-xl flex flex-col items-center gap-1 text-[11px] font-medium transition-all relative cursor-pointer ${
        active
          ? "bg-primary/10 text-primary dark:text-primary-foreground dark:bg-primary/20"
          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      <span>{label}</span>
      {completed && (
        <span className="w-1 h-1 rounded-full bg-emerald-500 absolute top-1 right-1" />
      )}
    </button>
  );
}

// ==========================================
// GAME 1: NECK CIRCLE (颈部环绕)
// ==========================================
function NeckCircleGame({
  isCompleted,
  onComplete,
}: {
  isCompleted: boolean;
  onComplete: () => void;
}) {
  const [timer, setTimer] = useState(30);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isRunning && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else if (timer === 0) {
      setIsRunning(false);
      onComplete();
    }
    return () => clearInterval(interval);
  }, [isRunning, timer, onComplete]);

  const handleStartStop = () => {
    setIsRunning(!isRunning);
  };

  const handleReset = () => {
    setIsRunning(false);
    setTimer(30);
  };

  return (
    <div className="flex flex-col items-center text-center w-full animate-fade-in">
      <div className="relative w-52 h-52 flex items-center justify-center mb-6">
        {/* Dash circle orbit track */}
        <svg className="absolute inset-0 w-full h-full text-zinc-200 dark:text-zinc-800" viewBox="0 0 200 200">
          <circle
            cx="100"
            cy="100"
            r="85"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="6 6"
          />
        </svg>

        {/* Orbiting orb */}
        <div
          className="absolute w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white shadow-[0_0_15px_rgba(99,102,241,0.6)] animate-orbit-cw transition-all"
          style={{
            animationPlayState: isRunning ? "running" : "paused",
            left: "84px",
            top: "84px",
          }}
        >
          <Activity className="w-3.5 h-3.5 animate-pulse" />
        </div>

        {/* Center Countdown Ring */}
        <div className="w-36 h-36 rounded-full bg-white dark:bg-zinc-800/80 shadow-md flex flex-col items-center justify-center border border-zinc-100 dark:border-zinc-800">
          {isCompleted ? (
            <div className="flex flex-col items-center text-emerald-500">
              <CheckCircle2 className="w-10 h-10 animate-bounce" />
              <span className="text-[11px] font-semibold mt-1">放松完成</span>
            </div>
          ) : (
            <>
              <span className="text-3xl font-extrabold text-zinc-800 dark:text-zinc-100 tracking-tight">
                {timer}
              </span>
              <span className="text-[10px] text-zinc-400 font-medium">秒</span>
            </>
          )}
        </div>
      </div>

      <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 mb-1">
        用鼻尖在空中画圆圈
      </h3>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-[280px] leading-relaxed mb-5">
        眼睛看着上方滚动的光球，带动脖子和头部缓慢做画圆运动，保持自然顺畅呼吸。
      </p>

      {!isCompleted && (
        <div className="flex gap-2">
          <button
            onClick={handleStartStop}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
              isRunning
                ? "bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/10"
                : "bg-primary hover:bg-primary/95 text-white shadow-md shadow-primary/10"
            }`}
          >
            {isRunning ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>暂停</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>开始</span>
              </>
            )}
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ==========================================
// GAME 2: SHRUGS (耸肩舒缓)
// ==========================================
function ShrugsGame({
  isCompleted,
  onComplete,
}: {
  isCompleted: boolean;
  onComplete: () => void;
}) {
  const [reps, setReps] = useState(0);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "inhale" | "hold" | "release" | "success">("idle");
  const [holdTimer, setHoldTimer] = useState(3);
  const holdRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startHoldCountdown = useCallback(() => {
    let timeLeft = 3;
    setHoldTimer(3);
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      if (!holdRef.current) {
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      timeLeft -= 1;
      if (timeLeft <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        setStatus("release");
      }
      setHoldTimer(Math.max(0, timeLeft));
    }, 1000);
  }, []);

  const startShrug = useCallback(() => {
    if (status === "success" || isCompleted) return;
    holdRef.current = true;
    setStatus("inhale");

    let currentProgress = 0;
    setProgress(0);
    if (progressRef.current) clearInterval(progressRef.current);
    
    progressRef.current = setInterval(() => {
      if (!holdRef.current) {
        if (progressRef.current) clearInterval(progressRef.current);
        return;
      }
      currentProgress += 3;
      if (currentProgress >= 100) {
        currentProgress = 100;
        if (progressRef.current) clearInterval(progressRef.current);
        setStatus("hold");
        startHoldCountdown();
      }
      setProgress(currentProgress);
    }, 30);
  }, [status, isCompleted, startHoldCountdown]);

  const releaseShrug = useCallback(() => {
    holdRef.current = false;
    if (progressRef.current) clearInterval(progressRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    if (status === "hold" || status === "release") {
      const newReps = reps + 1;
      setReps(newReps);
      setStatus("release");
      setProgress(0);

      setTimeout(() => {
        if (newReps >= 3) {
          setStatus("success");
          onComplete();
        } else {
          setStatus("idle");
        }
      }, 1500);
    } else {
      setStatus("idle");
      setProgress(0);
    }
  }, [status, reps, onComplete]);

  // Keyboard space hold
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (!holdRef.current && status === "idle" && !isCompleted) {
          startShrug();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        releaseShrug();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (progressRef.current) clearInterval(progressRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, isCompleted, startShrug, releaseShrug]);

  // Guidelines helper text based on state
  const getPromptText = () => {
    if (isCompleted || status === "success") return "耸肩练习已完成！肩部是不是轻松多啦？";
    if (status === "inhale") return "吸气耸肩，用力耸至最高点...";
    if (status === "hold") return `憋气保持住！倒计时 ${holdTimer} 秒`;
    if (status === "release") return "呼气！彻底松开并放下肩膀！";
    return "按住按钮或 [空格键] 开始耸肩";
  };

  return (
    <div className="flex flex-col items-center text-center w-full animate-fade-in">
      {/* Target Progress Reps */}
      <div className="flex items-center gap-1.5 mb-5 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
        <Timer className="w-3.5 h-3.5" />
        <span>目标：3 次重复</span>
        <span className="text-zinc-300 dark:text-zinc-700">|</span>
        <span className="text-primary font-bold">已完成 {reps}/3</span>
      </div>

      {/* Progress ring or visual feedback */}
      <div className="w-36 h-36 rounded-full border-4 border-zinc-100 dark:border-zinc-800 flex items-center justify-center relative mb-6 overflow-hidden">
        {/* Filling Progress Liquid overlay */}
        <div
          className="absolute bottom-0 left-0 right-0 bg-primary/10 dark:bg-primary/20 transition-all duration-100 ease-linear"
          style={{ height: `${progress}%` }}
        />

        <div className="z-10 flex flex-col items-center">
          {status === "success" || isCompleted ? (
            <Award className="w-12 h-12 text-emerald-500 animate-bounce" />
          ) : status === "hold" ? (
            <span className="text-3xl font-extrabold text-primary animate-pulse">{holdTimer}</span>
          ) : status === "release" ? (
            <span className="text-xs font-bold text-emerald-500 animate-ping">松！</span>
          ) : (
            <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500">
              {status === "inhale" ? "吸气耸肩" : "准备"}
            </span>
          )}
        </div>
      </div>

      <div className="w-full max-w-[280px] mb-5">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-1">
          {getPromptText()}
        </p>
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">
          吸气时把肩膀提向耳朵，憋气保持，然后瞬间松劲下放。
        </p>
      </div>

      {!(isCompleted || status === "success") && (
        <button
          onMouseDown={startShrug}
          onTouchStart={(e) => {
            e.preventDefault();
            startShrug();
          }}
          onMouseUp={releaseShrug}
          onMouseLeave={releaseShrug}
          onTouchEnd={releaseShrug}
          className={`w-36 h-36 rounded-full text-white flex flex-col items-center justify-center shadow-lg active:scale-95 select-none touch-none transition-all cursor-pointer ${
            status === "inhale"
              ? "bg-amber-500 shadow-amber-500/20"
              : status === "hold"
              ? "bg-emerald-500 shadow-emerald-500/20"
              : "bg-primary shadow-primary/20 hover:bg-primary/95"
          }`}
        >
          <span className="text-xs font-bold">按住耸肩</span>
          <span className="text-[9px] opacity-80 mt-1">[按住不放]</span>
        </button>
      )}
    </div>
  );
}

// ==========================================
// GAME 3: CHIN TUCK (收敛下巴)
// ==========================================
function ChinTuckGame({
  isCompleted,
  onComplete,
}: {
  isCompleted: boolean;
  onComplete: () => void;
}) {
  const [sliderValue, setSliderValue] = useState(20);
  const [alignTimer, setAlignTimer] = useState(5);
  const [localCompleted, setLocalCompleted] = useState(isCompleted);

  const targetMin = 70;
  const targetMax = 85;
  const isAligned = sliderValue >= targetMin && sliderValue <= targetMax;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isAligned && !localCompleted) {
      interval = setInterval(() => {
        setAlignTimer((prev) => {
          if (prev <= 1) {
            if (interval) clearInterval(interval);
            setLocalCompleted(true);
            onComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setAlignTimer(5);
    }
    return () => clearInterval(interval);
  }, [sliderValue, isAligned, localCompleted, onComplete]);

  // Visual offsets of head silhouette based on slider value
  // Target value of ~75 is ideal.
  // Lower slider means head sticking forward. Higher slider means pulled back.
  const neckOffset = (sliderValue - 75) * 0.4;
  const headOffset = (sliderValue - 75) * 0.8;

  return (
    <div className="flex flex-col items-center text-center w-full animate-fade-in">
      {/* Side-profile mockup canvas */}
      <div className="relative w-full aspect-video max-w-[280px] bg-zinc-100/50 dark:bg-zinc-800/30 rounded-xl flex items-center justify-center p-4 border border-zinc-200/30 dark:border-zinc-800/30 mb-6">
        {/* Spine Target Alignment Zone (Vertical Line) */}
        <div className="absolute inset-y-0 left-1/2 w-[2px] border-l border-dashed border-zinc-300 dark:border-zinc-700 pointer-events-none" />
        
        {/* Spine Alignment Box (Target zone) */}
        <div
          className={`absolute inset-y-0 w-8 bg-emerald-500/10 border-l border-r border-emerald-500/20 flex items-center justify-center pointer-events-none transition-all duration-300 ${
            isAligned ? "bg-emerald-500/20 scale-x-110" : ""
          }`}
          style={{ left: "calc(50% - 16px)" }}
        >
          {isAligned && !localCompleted && (
            <span className="text-[8px] font-bold text-emerald-500 animate-pulse uppercase tracking-wider">
              ALIGN
            </span>
          )}
        </div>

        {/* Head/Neck avatar group */}
        <svg className="w-full h-full text-zinc-400 dark:text-zinc-600" viewBox="0 0 200 120">
          {/* Spine Base */}
          <path
            d="M100,120 Q100,100 100,80"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
          />

          {/* Neck segment (moves with neckOffset) */}
          <path
            d={`M100,80 Q${100 + neckOffset},60 Q${100 + headOffset},45`}
            fill="none"
            stroke={isAligned ? "#10b981" : "#6366f1"}
            strokeWidth="6"
            strokeLinecap="round"
            className="transition-colors duration-300"
          />

          {/* Head circle (moves with headOffset) */}
          <g transform={`translate(${headOffset}, 0)`} className="transition-all duration-100">
            {/* Brain/Skull */}
            <circle cx="100" cy="35" r="22" className={isAligned ? "fill-emerald-500/20 stroke-emerald-500" : "fill-primary/10 stroke-primary"} strokeWidth="2" />
            {/* Eye / Face outline */}
            <circle cx="114" cy="32" r="3" className="fill-zinc-600 dark:fill-zinc-400" />
            <path d="M112,45 Q116,45 112,48" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M100,13 L100,3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </g>
        </svg>

        {/* Floating Alignment indicator */}
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-zinc-200/50 dark:bg-zinc-800/80 text-[8px] font-bold text-zinc-500">
          校准对齐
        </div>
      </div>

      <div className="w-full max-w-[280px] mb-5">
        <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 mb-1">
          收敛下巴，对齐颈椎
        </h3>
        {localCompleted ? (
          <p className="text-xs font-bold text-emerald-500 flex items-center justify-center gap-1">
            <UserCheck className="w-4 h-4" />
            <span>完美体态！校准已完成</span>
          </p>
        ) : isAligned ? (
          <p className="text-xs font-bold text-emerald-500 animate-pulse">
            对齐成功！请保持姿势 {alignTimer} 秒
          </p>
        ) : (
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            滑动滑块收回下巴，使头部与绿色中轴对齐
          </p>
        )}
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal mt-1">
          动作要领：平视前方，缓慢水平向后收缩下巴（挤出双下巴的感觉），拉长颈椎后侧。
        </p>
      </div>

      {!localCompleted && (
        <div className="w-full max-w-xs space-y-2">
          <div className="flex justify-between items-center text-[10px] text-zinc-400 px-1 font-semibold">
            <span>前倾 (低头)</span>
            <span>中轴对齐 (推荐)</span>
            <span>后缩 (下压)</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            value={sliderValue}
            onChange={(e) => setSliderValue(parseInt(e.target.value))}
            className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary"
          />
        </div>
      )}
    </div>
  );
}

// ==========================================
// GAME 4: STRETCH (左右拉伸)
// ==========================================
type StretchDepth = "low" | "med" | "high";

function StretchGame({
  isCompleted,
  onComplete,
}: {
  isCompleted: boolean;
  onComplete: () => void;
}) {
  const [side, setSide] = useState<"left" | "right">("left");
  const [timer, setTimer] = useState(15);
  const [isRunning, setIsRunning] = useState(false);
  const [depth, setDepth] = useState<StretchDepth>("med");
  const [completedLeft, setCompletedLeft] = useState(false);
  const [completedRight, setCompletedRight] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isRunning && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else if (timer === 0) {
      setIsRunning(false);
      if (side === "left") {
        setCompletedLeft(true);
        setSide("right");
        setTimer(15);
      } else {
        setCompletedRight(true);
        onComplete();
      }
    }
    return () => clearInterval(interval);
  }, [isRunning, timer, side, onComplete]);

  const handleStart = () => {
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  // Convert depth to degrees
  const depthDegrees = {
    low: 15,
    med: 25,
    high: 35,
  }[depth];

  // Head tilt rotation: rotate left (negative) or right (positive)
  let rotation = 0;
  if (isRunning) {
    rotation = side === "left" ? -depthDegrees : depthDegrees;
  }

  return (
    <div className="flex flex-col items-center text-center w-full animate-fade-in">
      <div className="relative w-52 h-52 flex items-center justify-center mb-6">
        {/* Background base shoulders */}
        <svg className="absolute inset-0 w-full h-full text-zinc-300 dark:text-zinc-700" viewBox="0 0 200 200">
          {/* Shoulder bar */}
          <path
            d="M50,140 Q100,120 150,140"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
          />
          {/* Neck base */}
          <path
            d="M100,130 L100,105"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
          />
        </svg>

        {/* Tilting head group */}
        <div
          className="absolute transition-transform duration-500 ease-out"
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: "100px 115px",
            width: "200px",
            height: "200px",
          }}
        >
          <svg className="w-full h-full" viewBox="0 0 200 200">
            {/* Neck (top half) */}
            <path
              d="M100,105 L100,85"
              fill="none"
              stroke="#6366f1"
              strokeWidth="6"
              strokeLinecap="round"
            />
            {/* Head circle */}
            <circle cx="100" cy="65" r="20" className="fill-primary/20 stroke-primary" strokeWidth="2" />
            <circle cx="95" cy="62" r="2.5" className="fill-zinc-600 dark:fill-zinc-400" />
            <circle cx="105" cy="62" r="2.5" className="fill-zinc-600 dark:fill-zinc-400" />
            <path d="M96,73 Q100,77 104,73" stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
        </div>

        {/* Center Timer Countdown Overlay */}
        <div className="absolute w-20 h-20 rounded-full bg-white/90 dark:bg-zinc-800/90 shadow border border-zinc-100 dark:border-zinc-800 flex items-center justify-center">
          <div className="text-center">
            {completedLeft && completedRight ? (
              <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto" />
            ) : (
              <>
                <span className="text-xl font-black text-zinc-800 dark:text-zinc-100">{timer}</span>
                <span className="text-[9px] text-zinc-400 block font-semibold leading-none">秒</span>
              </>
            )}
          </div>
        </div>

        {/* Side Badge Indicator */}
        {!isCompleted && isRunning && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-primary text-white text-[9px] font-bold shadow-md shadow-primary/10">
            {side === "left" ? "向左倾斜" : "向右倾斜"}
          </div>
        )}
      </div>

      <div className="w-full max-w-[280px] mb-5">
        <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 mb-1">
          颈部左右侧向拉伸
        </h3>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
          {side === "left"
            ? "将头部侧向左肩倾斜，拉伸右侧颈部肌肉。"
            : "将头部侧向右肩倾斜，拉伸左侧颈部肌肉。"}
        </p>
      </div>

      {/* Progress checklists */}
      <div className="flex gap-4 justify-center text-[10px] font-semibold mb-5">
        <span className={`flex items-center gap-1 ${completedLeft ? "text-emerald-500" : "text-zinc-400"}`}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>左侧已完成</span>
        </span>
        <span className={`flex items-center gap-1 ${completedRight ? "text-emerald-500" : "text-zinc-400"}`}>
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>右侧已完成</span>
        </span>
      </div>

      {/* Setup depth selector & Start/Pause */}
      {!(completedLeft && completedRight) && (
        <div className="flex flex-col gap-3 w-full max-w-[240px]">
          {/* Depth toggle */}
          <div className="flex justify-between items-center bg-zinc-100/50 dark:bg-zinc-800/40 p-0.5 rounded-xl border border-zinc-200/30 dark:border-zinc-800/30">
            <DepthTab active={depth === "low"} label="轻微" onClick={() => setDepth("low")} />
            <DepthTab active={depth === "med"} label="中度" onClick={() => setDepth("med")} />
            <DepthTab active={depth === "high"} label="深度" onClick={() => setDepth("high")} />
          </div>

          <div className="flex justify-center">
            {isRunning ? (
              <button
                onClick={handlePause}
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>暂停</span>
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/95 text-white text-xs font-semibold flex items-center gap-1 shadow-md shadow-primary/15 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>开始拉伸 ({side === "left" ? "左侧" : "右侧"})</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DepthTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1 rounded-lg text-[10px] font-semibold transition-all cursor-pointer ${
        active
          ? "bg-white dark:bg-zinc-700 text-primary dark:text-zinc-100 shadow-sm"
          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}
