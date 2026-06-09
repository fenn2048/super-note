import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Square } from "lucide-react";

interface RecordingPanelProps {
  duration: number;
  /** 外部传入的波形数据 (0~1)，若提供则直接渲染，不再自行采集音频 */
  waveformData?: number[];
  onRecordingComplete: () => void;
  onCancel: () => void;
}

/**
 * RecordingPanel - 录音控制面板
 * 覆盖在输入框底部区域，带有呼吸灯效果和实时波形图。
 *
 * 有两种工作模式：
 * 1. 外部传入 waveformData：直接渲染（推荐，避免重复 getUserMedia）
 * 2. 无外部数据：自行采集音频（向后兼容，独立使用场景）
 */
export default function RecordingPanel({
  duration,
  waveformData,
  onRecordingComplete,
  onCancel,
}: RecordingPanelProps) {
  const internalBars = useRef<number[]>(new Array(20).fill(0.1));

  // 无外部数据时自行采集音频
  useEffect(() => {
    if (waveformData) return; // 外部已提供，不需要自行采集

    let animFrame: number;
    let audioCtx: AudioContext | null = null;

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteFrequencyData(dataArray);
          for (let i = 0; i < 20; i++) {
            internalBars.current[i] = dataArray[i] / 255;
          }
          animFrame = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        console.error("Failed to initialize audio:", err);
      }
    };

    init();

    return () => {
      cancelAnimationFrame(animFrame);
      if (audioCtx) audioCtx.close();
    };
  }, [waveformData]);

  // 使用外部或内部波形数据
  const bars = waveformData ?? internalBars.current;

  // 格式化时间
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="w-full border-t border-app-border/50 bg-app-bg overflow-hidden"
    >
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        {/* 左侧：录音状态指示器 */}
        <div className="flex items-center gap-3 min-w-0">
          {/* 呼吸灯效果 */}
          <div className="relative shrink-0">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <motion.div
              animate={{ scale: [1, 1.5, 1], opacity: [0.7, 0, 0.7] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-0 w-3 h-3 rounded-full bg-red-500"
            />
          </div>

          {/* 录音中文字 */}
          <span className="text-sm font-medium text-red-500 whitespace-nowrap">
            录音中...
          </span>

          {/* 波形图 - 实时反馈 */}
          <div className="flex items-end gap-[2px] h-8 px-2 flex-1 min-w-[80px]">
            {bars.map((value, index) => (
              <motion.div
                key={index}
                animate={{ height: `${Math.max(3, value * 28)}px` }}
                transition={{ duration: 0.08, ease: "easeOut" }}
                className="w-[3px] rounded-full bg-red-400/80"
              />
            ))}
          </div>

          {/* 时长显示 */}
          <span className="text-base font-mono tabular-nums text-tx-secondary whitespace-nowrap">
            {formatTime(duration)}
          </span>
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 取消按钮 */}
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs text-tx-secondary hover:bg-app-hover transition-all"
          >
            取消
          </button>

          {/* 停止并保存按钮 */}
          <button
            onClick={onRecordingComplete}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all shadow-md shadow-red-500/20"
          >
            <Square size={12} fill="currentColor" />
            <span>停止并保存</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
