import React, { useState, useEffect } from "react";
import { Sparkles, RotateCcw, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface AiFormatHelperProps {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}

export const AiFormatHelper: React.FC<AiFormatHelperProps> = ({ value, onChange, className }) => {
  const [loading, setLoading] = useState(false);
  const [originalText, setOriginalText] = useState("");
  const [hasFormatted, setHasFormatted] = useState(false);

  // We show the helper if the value contains @su, OR if we have already formatted and want to undo
  const hasSu = value.includes("@su");

  // Reset the formatted state if the user manually changes the text after formatting
  useEffect(() => {
    if (hasFormatted && value !== originalText && !value.includes(originalText) && originalText !== "") {
      // If the user manually edited the text, hide the undo button
      setHasFormatted(false);
    }
  }, [value, hasFormatted, originalText]);

  if (!hasSu && !hasFormatted) return null;

  const handleAIFormat = async () => {
    // Get clean text without @su
    const cleanText = value.replace(/@su\s*/g, "").trim();
    if (!cleanText) {
      toast.error("请输入文字后再进行 AI 整理");
      return;
    }
    setLoading(true);
    setOriginalText(value);
    try {
      const formatted = await api.formatDiaryText(cleanText);
      onChange(formatted);
      setHasFormatted(true);
      toast.success("AI 整理完成");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "AI 整理失败");
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = () => {
    onChange(originalText);
    setHasFormatted(false);
  };

  return (
    <div className={cn("flex items-center gap-2 mt-1 justify-end animate-in fade-in duration-200", className)}>
      {loading ? (
        <span className="flex items-center gap-1 text-[10px] text-tx-tertiary">
          <Loader2 size={12} className="animate-spin text-accent-primary" />
          AI 正在整理中...
        </span>
      ) : hasFormatted ? (
        <button
          type="button"
          onClick={handleUndo}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-semibold transition-all"
        >
          <RotateCcw size={10} />
          撤销 AI 整理
        </button>
      ) : (
        <button
          type="button"
          onClick={handleAIFormat}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary text-[10px] font-semibold transition-all animate-pulse"
        >
          <Sparkles size={10} />
          点击进行 AI 整理
        </button>
      )}
    </div>
  );
};
