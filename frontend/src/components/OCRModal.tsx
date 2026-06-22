import React, { useState, useRef, useEffect } from "react";
import { X, Copy, Check, ScanText, Loader2, ImagePlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/lib/toast";
import Tesseract from "tesseract.js";
import { cn } from "@/lib/utils";

interface OCRModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}

export default function OCRModal({ isOpen, onClose, onInsert }: OCRModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState("");
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up object URL
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setRecognizedText("");
      setIsRecognizing(false);
      setProgress(0);
      setProgressStatus("");
      setCopied(false);
    }
  }, [isOpen, previewUrl]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setRecognizedText("");
    
    // Automatically start recognizing
    startRecognizing(file);
    
    // Reset file input so same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const startRecognizing = async (imageFile: File) => {
    setIsRecognizing(true);
    setProgress(0);
    setProgressStatus("初始化中...");
    
    try {
      const result = await Tesseract.recognize(
        imageFile,
        'chi_sim+eng',
        {
          logger: m => {
            if (m.status === "recognizing text") {
              setProgressStatus("正在识别文字...");
              setProgress(Math.floor(m.progress * 100));
            } else {
              setProgressStatus("加载模型资源中...");
            }
          }
        }
      );
      
      const text = result.data.text.trim();
      if (!text) {
        toast.warning("未能识别出文字，请换一张更清晰的图片试试");
      } else {
        toast.success("文字提取成功！");
      }
      setRecognizedText(text);
    } catch (err: Error | unknown) {
      console.error("OCR Error:", err);
      toast.error("文字识别失败，请稍后重试");
    } finally {
      setIsRecognizing(false);
      setProgress(100);
      setProgressStatus("");
    }
  };

  const handleCopy = () => {
    if (!recognizedText) return;
    navigator.clipboard.writeText(recognizedText)
      .then(() => {
        setCopied(true);
        toast.success("已复制到剪贴板");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        toast.error("复制失败，请手动复制");
      });
  };

  const handleInsert = () => {
    if (!recognizedText) return;
    onInsert(recognizedText);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-4xl bg-app-surface rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-app-border shrink-0">
            <div className="flex items-center gap-2 text-tx-primary">
              <ScanText size={20} className="text-accent-primary" />
              <h3 className="text-lg font-bold">提取图片文字</h3>
            </div>
            <button
              onClick={onClose}
              className="p-2 -mr-2 rounded-full hover:bg-app-hover text-tx-secondary hover:text-tx-primary transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row bg-app-background/50">
            {/* Left: Image Preview */}
            <div className="w-full md:w-1/2 border-b md:border-b-0 md:border-r border-app-border flex flex-col bg-app-surface">
              <div className="flex-1 p-4 flex flex-col min-h-[200px]">
                {!previewUrl ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-app-border rounded-xl hover:border-accent-primary/50 hover:bg-accent-primary/5 transition-colors gap-3 group"
                  >
                    <div className="w-16 h-16 rounded-full bg-app-hover flex items-center justify-center text-tx-tertiary group-hover:text-accent-primary group-hover:scale-110 transition-all">
                      <ImagePlus size={32} />
                    </div>
                    <div className="text-center">
                      <p className="font-semibold text-tx-primary">点击选择图片</p>
                      <p className="text-sm text-tx-tertiary mt-1">支持本地相册图片</p>
                    </div>
                  </button>
                ) : (
                  <div className="relative flex-1 rounded-xl overflow-hidden bg-black/5 group">
                    <img 
                      src={previewUrl} 
                      alt="OCR Preview" 
                      className="w-full h-full object-contain"
                    />
                    
                    {/* Recognizing Overlay */}
                    {isRecognizing && (
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex flex-col items-center justify-center text-white z-10">
                        <Loader2 size={40} className="animate-spin text-accent-primary mb-4" />
                        <p className="font-semibold mb-2">{progressStatus}</p>
                        {progress > 0 && (
                          <div className="w-48 h-1.5 bg-white/20 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-accent-primary transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Re-select button */}
                    {!isRecognizing && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute bottom-4 right-4 bg-black/60 hover:bg-black/80 text-white px-3 py-1.5 rounded-lg text-sm font-medium backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5"
                      >
                        <ImagePlus size={16} />
                        重新选择
                      </button>
                    )}
                  </div>
                )}
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageSelect}
                />
              </div>
            </div>

            {/* Right: Recognized Text */}
            <div className="w-full md:w-1/2 flex flex-col h-[40vh] md:h-auto bg-app-surface">
              <div className="flex-1 p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-tx-secondary">识别结果</span>
                  {recognizedText && !isRecognizing && (
                    <button
                      onClick={handleCopy}
                      className={cn(
                        "flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md transition-colors",
                        copied 
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" 
                          : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
                      )}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "已复制" : "复制全文"}
                    </button>
                  )}
                </div>
                
                {isRecognizing ? (
                  <div className="flex-1 border border-app-border rounded-xl bg-app-hover/30 animate-pulse flex items-center justify-center text-tx-tertiary">
                    <div className="flex flex-col items-center gap-3">
                      <ScanText size={32} className="opacity-50" />
                      <span className="text-sm">正在解析内容，请稍候...</span>
                    </div>
                  </div>
                ) : (
                  <textarea
                    value={recognizedText}
                    onChange={(e) => setRecognizedText(e.target.value)}
                    placeholder={previewUrl ? "未能识别出文字或图片中没有文字" : "请先在左侧选择需要提取文字的图片"}
                    disabled={!previewUrl || isRecognizing}
                    className="flex-1 w-full border border-app-border focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/50 rounded-xl p-4 bg-transparent text-tx-primary text-sm leading-relaxed resize-none transition-colors"
                  />
                )}
              </div>

              {/* Action Buttons */}
              <div className="p-4 border-t border-app-border bg-app-background/50 flex justify-end gap-3 shrink-0">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-tx-secondary hover:bg-app-hover transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleInsert}
                  disabled={!recognizedText || isRecognizing}
                  className="px-6 py-2 rounded-xl text-sm font-bold bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                >
                  一键插入
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
