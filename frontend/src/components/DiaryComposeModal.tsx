import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Smile, Tag as TagIcon, Globe, Lock, Mic, Play, Pause, Trash2, X, Send, Loader2 } from "lucide-react";
import { api, getCurrentWorkspace } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/AppContext";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { motion, AnimatePresence } from "framer-motion";

interface DiaryComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPost: () => void;
}

export default function DiaryComposeModal({ isOpen, onClose, onPost }: DiaryComposeModalProps) {
  const { t } = useTranslation();
  const { state } = useApp();
  const [text, setText] = useState("");
  const [mood, setMood] = useState("");
  const [showMoods, setShowMoods] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [selectedTags, setSelectedTags] = useState<any[]>([]);
  const [visibility, setVisibility] = useState<string>(() => {
    const ws = getCurrentWorkspace();
    return ws && ws !== "personal" ? "PUBLIC" : "PRIVATE";
  });
  const [posting, setPosting] = useState(false);

  // Images Grid (说说支持拍照上传图片，支持图片九宫格展示)
  const [images, setImages] = useState<{ id: string; url: string }[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Audio Recording States
  const [recording, setRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [pendingVoice, setPendingVoice] = useState<{ id: string; duration: number } | null>(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  
  // Audio Player States
  const [playingVoice, setPlayingVoice] = useState(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Recorder Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);

  // Textarea & Selection states
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(0);

  // Keyboard visible status to adapt inputMode
  const [textareaInputMode, setTextareaInputMode] = useState<"text" | "none">("text");

  // Heartbeat/flash recording status
  const [recordBlink, setRecordBlink] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Auto focus textarea
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Blink recording indicator
  useEffect(() => {
    let interval: any;
    if (recording) {
      interval = setInterval(() => {
        setRecordBlink((b) => !b);
      }, 500);
    } else {
      setRecordBlink(false);
    }
    return () => clearInterval(interval);
  }, [recording]);

  // Track recording duration
  useEffect(() => {
    if (recording) {
      recordTimerRef.current = setInterval(() => {
        setRecordDuration((d) => d + 1);
      }, 1000);
    } else {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      setRecordDuration(0);
    }
    return () => clearInterval(recordTimerRef.current);
  }, [recording]);

  // Audio preview play/pause tracker
  useEffect(() => {
    const el = audioPlayerRef.current;
    if (!el) return;
    const onEnded = () => setPlayingVoice(false);
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, [pendingVoice]);

  // Auto focus helper
  const focusEditor = () => {
    setTextareaInputMode("text");
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  // ----------------- Recording Logic -----------------
  const handleRecordClick = async () => {
    if (recording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setRecording(false);
    } else {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        let duration = 0;
        const durInterval = setInterval(() => {
          duration += 1;
        }, 1000);

        mediaRecorder.onstop = async () => {
          clearInterval(durInterval);
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const file = new File([audioBlob], `voice_${Date.now()}.webm`, { type: "audio/webm" });
          try {
            setVoiceUploading(true);
            const uploadRes = await api.diaryImages.upload(file);
            setPendingVoice({
              id: uploadRes.id,
              duration: duration || 1,
            });
            toast.success("录音生成成功");
          } catch (e) {
            console.error("Voice upload failed:", e);
            toast.error("录音上传失败");
          } finally {
            setVoiceUploading(false);
          }
          stream.getTracks().forEach((track) => track.stop());
        };

        mediaRecorder.start(200);
        setRecording(true);
      } catch (err) {
        console.error("Failed to start recording:", err);
        toast.error("无法访问录音设备");
      }
    }
  };

  const handlePlayVoice = () => {
    if (!pendingVoice) return;
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio(api.diaryImages.urlFor(pendingVoice.id));
      audioPlayerRef.current.addEventListener("ended", () => setPlayingVoice(false));
    }
    
    if (playingVoice) {
      audioPlayerRef.current.pause();
      setPlayingVoice(false);
    } else {
      audioPlayerRef.current.play();
      setPlayingVoice(true);
    }
  };

  const handleDeleteVoice = () => {
    if (!pendingVoice) return;
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    setPlayingVoice(false);
    api.diaryImages.remove(pendingVoice.id).catch(() => {});
    setPendingVoice(null);
  };

  // ----------------- Image upload -----------------
  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (images.length + files.length > 9) {
      toast.warning("最多只能上传 9 张图片");
      return;
    }

    setUploadingImage(true);
    try {
      for (const file of files) {
        const res = await api.diaryImages.upload(file);
        setImages((prev) => [...prev, { id: res.id, url: api.diaryImages.urlFor(res.id) }]);
      }
      toast.success("图片上传成功");
    } catch (err: any) {
      toast.error(err?.message || "图片上传失败");
    } finally {
      setUploadingImage(false);
      e.target.value = "";
    }
  };

  const handleRemoveImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
    api.diaryImages.remove(id).catch(() => {});
  };

  // ----------------- Emoji Keyboard area -----------------
  const EMOJIS = ["😊", "🥳", "😌", "🤔", "😴", "😢", "😤", "🤒", "🥰", "😎", "🤣", "😱", "👍", "🔥", "🎉", "❤️", "👏", "🙌", "✨", "🌟", "💡", "🍀", "📱", "🏠"];
  const MOODS = [
    { value: "happy", emoji: "😊", label: "开心" },
    { value: "excited", emoji: "🥳", label: "超棒" },
    { value: "peaceful", emoji: "😌", label: "平静" },
    { value: "thinking", emoji: "🤔", label: "思考" },
    { value: "tired", emoji: "😴", label: "疲惫" },
    { value: "sad", emoji: "😢", label: "难过" },
    { value: "angry", emoji: "😤", label: "生气" },
    { value: "sick", emoji: "🤒", label: "生病" },
    { value: "love", emoji: "🥰", label: "有爱" },
    { value: "cool", emoji: "😎", label: "酷" },
    { value: "laugh", emoji: "🤣", label: "搞笑" },
    { value: "shock", emoji: "😱", label: "吃惊" },
  ];

  const handleEmojiSelect = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const nextText = text.slice(0, start) + emoji + text.slice(end);
    setText(nextText);
    
    // Position cursor after inserted emoji
    setTimeout(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    }, 50);
  };

  const handleMoodSelect = (value: string) => {
    setMood(mood === value ? "" : value);
  };

  const handleMoodBtnClick = () => {
    if (showMoods) {
      focusEditor();
      setShowMoods(false);
    } else {
      // Hide native keyboard by setting inputMode to none and blurring/focusing
      setTextareaInputMode("none");
      textareaRef.current?.blur();
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      setShowMoods(true);
      setShowTags(false);
    }
  };

  const handleTagToggle = (tag: any) => {
    if (selectedTags.some((t) => t.id === tag.id)) {
      setSelectedTags((prev) => prev.filter((t) => t.id !== tag.id));
    } else {
      setSelectedTags((prev) => [...prev, tag]);
    }
  };

  // ----------------- Custom text selection controls -----------------
  // Handle text selection change via standard selection API (for long press)
  const handleTextareaSelectionChange = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    
    if (start !== end) {
      setSelStart(start);
      setSelEnd(end);
      setSelectionMode(true);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = textareaRef.current;
    if (!el || text.length === 0) return;

    // Trigger selection mode
    setSelectionMode(true);
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;

    if (start === end) {
      // Select a small word/range around cursor
      const left = Math.max(0, start - 2);
      const right = Math.min(text.length, start + 2);
      setSelStart(left);
      setSelEnd(right);
      el.setSelectionRange(left, right);
    } else {
      setSelStart(start);
      setSelEnd(end);
    }
  };

  const sliderTrackRef = useRef<HTMLDivElement>(null);

  const handleLeftSliderMove = (e: React.TouchEvent) => {
    if (!sliderTrackRef.current || text.length === 0) return;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const idx = Math.min(selEnd, Math.round(pct * text.length));
    setSelStart(idx);
    textareaRef.current?.setSelectionRange(idx, selEnd);
  };

  const handleRightSliderMove = (e: React.TouchEvent) => {
    if (!sliderTrackRef.current || text.length === 0) return;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const idx = Math.max(selStart, Math.round(pct * text.length));
    setSelEnd(idx);
    textareaRef.current?.setSelectionRange(selStart, idx);
  };

  // Text selection actions
  const handleSelectAll = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.setSelectionRange(0, text.length);
    setSelStart(0);
    setSelEnd(text.length);
    el.focus();
  };

  const handleCopy = () => {
    const selected = text.slice(selStart, selEnd);
    if (!selected) return;
    navigator.clipboard.writeText(selected).then(() => {
      toast.success("已复制到剪贴板");
    });
  };

  const handleCut = () => {
    const selected = text.slice(selStart, selEnd);
    if (!selected) return;
    navigator.clipboard.writeText(selected).then(() => {
      const nextText = text.slice(0, selStart) + text.slice(selEnd);
      setText(nextText);
      setSelEnd(selStart);
      setSelectionMode(false);
      toast.success("已剪切");
    });
  };

  const handlePaste = () => {
    const el = textareaRef.current;
    if (!el) return;
    navigator.clipboard.readText().then((clipText) => {
      const nextText = text.slice(0, selStart) + clipText + text.slice(selEnd);
      setText(nextText);
      const nextPos = selStart + clipText.length;
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(nextPos, nextPos);
      }, 50);
      setSelectionMode(false);
    }).catch(() => {
      toast.error("无法读取剪贴板");
    });
  };

  // ----------------- Submit post -----------------
  const handlePublish = async () => {
    if (posting) return;
    if (!text.trim() && images.length === 0 && !pendingVoice) {
      toast.warning("请输入内容，上传图片或录音");
      return;
    }

    setPosting(true);
    try {
      await api.postDiary({
        contentText: text.trim(),
        mood,
        images: images.map((img) => img.id),
        visibility,
        voice: pendingVoice,
        tagIds: selectedTags.map((t) => t.id),
      });
      
      toast.success("说说发布成功！");
      // Reset
      setText("");
      setMood("");
      setImages([]);
      setSelectedTags([]);
      setPendingVoice(null);
      onPost();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "说说发布失败");
    } finally {
      setPosting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-app-bg flex flex-col overflow-hidden">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-surface shrink-0" style={{ paddingTop: "calc(var(--safe-area-top) + 8px)" }}>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-tx-secondary hover:bg-app-hover active:scale-95"
          aria-label="关闭"
        >
          <ChevronDown size={24} />
        </button>
        <span className="text-sm font-semibold text-tx-primary">新建说说</span>
        <button
          onClick={handlePublish}
          disabled={posting}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-primary text-white text-xs font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
        >
          {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          <span>发布</span>
        </button>
      </header>

      {/* 编辑区域 */}
      <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4 pb-20">
        <textarea
          ref={textareaRef}
          value={text}
          inputMode={textareaInputMode}
          onChange={(e) => setText(e.target.value)}
          onSelect={handleTextareaSelectionChange}
          onContextMenu={handleContextMenu}
          onClick={() => {
            if (textareaInputMode === "none") {
              setTextareaInputMode("text");
            }
            setShowMoods(false);
            setShowTags(false);
            setSelectionMode(false);
          }}
          placeholder="分享新鲜事..."
          className="w-full flex-1 bg-transparent text-sm text-tx-primary placeholder:text-tx-tertiary border-none outline-none resize-none min-h-[150px] focus:ring-0"
        />

        {/* 语音文件展示 */}
        {voiceUploading && (
          <div className="p-3 rounded-2xl bg-app-surface border border-app-border flex items-center gap-2">
            <Loader2 size={16} className="animate-spin text-accent-primary" />
            <span className="text-xs text-tx-tertiary">正在上传录音...</span>
          </div>
        )}

        {pendingVoice && (
          <div className="p-3 rounded-2xl bg-accent-primary/5 border border-accent-primary/10 flex items-center justify-between">
            <button
              onClick={handlePlayVoice}
              className="flex items-center gap-2.5 flex-1 text-left"
            >
              <div className="w-8 h-8 rounded-full bg-accent-primary/10 flex items-center justify-center text-accent-primary">
                {playingVoice ? <Pause size={14} /> : <Play size={14} />}
              </div>
              <div>
                <span className="text-xs font-semibold text-tx-primary">语音说说</span>
                <span className="text-[10px] text-tx-tertiary block mt-0.5">
                  时长: {Math.floor(pendingVoice.duration / 60)}分{pendingVoice.duration % 60}秒
                </span>
              </div>
            </button>
            <button
              onClick={handleDeleteVoice}
              className="w-8 h-8 rounded-full bg-app-hover hover:bg-red-500/10 text-tx-secondary hover:text-red-500 flex items-center justify-center transition-all"
              aria-label="删除录音"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}

        {/* 图片九宫格展示 */}
        {uploadingImage && (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin text-accent-primary" size={20} />
          </div>
        )}
        
        {images.length > 0 && (
          <div className={cn(
            "grid gap-2",
            images.length === 1 && "grid-cols-1",
            images.length === 2 && "grid-cols-2",
            images.length >= 3 && "grid-cols-3"
          )}>
            {images.map((img) => (
              <div
                key={img.id}
                className={cn(
                  "relative overflow-hidden rounded-xl border border-app-border bg-app-hover/30 group",
                  images.length === 1 ? "max-h-[240px] aspect-[4/3]" : "aspect-square"
                )}
              >
                <img
                  src={img.url}
                  alt="Upload preview"
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => handleRemoveImage(img.id)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 选中的标签展示 */}
        {selectedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {selectedTags.map((tag) => (
              <span
                key={tag.id}
                className="px-2.5 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1.5 bg-accent-primary/10 text-accent-primary border-accent-primary/20"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 隐藏的图片上传 input */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleUploadImage}
      />

      {/* 左右滑块与浮动选择菜单 */}
      {selectionMode && text.length > 0 && (
        <div className="p-3 bg-app-surface border-t border-app-border flex flex-col gap-2 shrink-0">
          {/* 浮动操作菜单 */}
          <div className="flex justify-around items-center bg-app-hover p-1 rounded-xl">
            <button onClick={handleSelectAll} className="text-xs px-3 py-1.5 font-semibold text-tx-secondary hover:text-tx-primary">全选</button>
            <div className="w-px h-4 bg-app-border" />
            <button onClick={handleCopy} className="text-xs px-3 py-1.5 font-semibold text-tx-secondary hover:text-tx-primary">复制</button>
            <div className="w-px h-4 bg-app-border" />
            <button onClick={handleCut} className="text-xs px-3 py-1.5 font-semibold text-tx-secondary hover:text-tx-primary">剪切</button>
            <div className="w-px h-4 bg-app-border" />
            <button onClick={handlePaste} className="text-xs px-3 py-1.5 font-semibold text-tx-secondary hover:text-tx-primary">粘贴</button>
            <div className="w-px h-4 bg-app-border" />
            <button onClick={() => setSelectionMode(false)} className="text-xs px-3 py-1.5 font-semibold text-red-500">取消</button>
          </div>
          {/* 滑块轨道 */}
          <div className="flex items-center gap-4 px-2 py-2">
            <span className="text-[10px] text-tx-tertiary">滑块选取</span>
            <div ref={sliderTrackRef} className="flex-1 h-6 relative flex items-center select-none touch-none">
              {/* 轨道线 */}
              <div className="w-full h-1 rounded bg-app-border/70" />
              {/* 高亮部分 */}
              <div
                className="absolute h-1 rounded bg-accent-primary"
                style={{
                  left: `${(selStart / text.length) * 100}%`,
                  width: `${((selEnd - selStart) / text.length) * 100}%`
                }}
              />
              {/* 左滑块 */}
              <div
                onTouchMove={handleLeftSliderMove}
                className="absolute w-5 h-5 bg-accent-primary border-2 border-white rounded-full shadow-lg cursor-pointer -translate-x-1/2 flex items-center justify-center text-[9px] text-white font-bold"
                style={{ left: `${(selStart / text.length) * 100}%` }}
              >
                L
              </div>
              {/* 右滑块 */}
              <div
                onTouchMove={handleRightSliderMove}
                className="absolute w-5 h-5 bg-accent-primary border-2 border-white rounded-full shadow-lg cursor-pointer -translate-x-1/2 flex items-center justify-center text-[9px] text-white font-bold"
                style={{ left: `${(selEnd / text.length) * 100}%` }}
              >
                R
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 心情表情选择和标签区域 */}
      <AnimatePresence>
        {showMoods && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="bg-app-surface border-t border-app-border overflow-hidden shrink-0"
          >
            <div className="p-4 max-h-[250px] overflow-y-auto space-y-4">
              {/* 心情列表 */}
              <div>
                <h4 className="text-[10px] font-semibold text-tx-tertiary uppercase tracking-wider mb-2">选择今天的心情</h4>
                <div className="grid grid-cols-6 gap-2">
                  {MOODS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => handleMoodSelect(m.value)}
                      className={cn(
                        "flex flex-col items-center justify-center p-2 rounded-xl border border-app-border bg-app-surface/50 hover:bg-app-hover active:scale-95 transition-all",
                        mood === m.value ? "border-accent-primary bg-accent-primary/10 ring-1 ring-accent-primary/30" : ""
                      )}
                    >
                      <span className="text-lg">{m.emoji}</span>
                      <span className="text-[10px] text-tx-secondary mt-1">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              {/* 表情键盘 */}
              <div>
                <h4 className="text-[10px] font-semibold text-tx-tertiary uppercase tracking-wider mb-2">常用表情</h4>
                <div className="grid grid-cols-8 gap-2">
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleEmojiSelect(emoji)}
                      className="w-10 h-10 rounded-lg bg-app-surface border border-app-border/40 flex items-center justify-center text-lg hover:bg-app-hover active:scale-90 transition-transform"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {showTags && state.tags.length > 0 && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="bg-app-surface border-t border-app-border overflow-hidden shrink-0"
          >
            <div className="p-4 max-h-[200px] overflow-y-auto">
              <h4 className="text-[10px] font-semibold text-tx-tertiary uppercase tracking-wider mb-2">选择说说标签</h4>
              <div className="flex flex-wrap gap-2">
                {state.tags.map((tag) => {
                  const active = selectedTags.some((t) => t.id === tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => handleTagToggle(tag)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all border",
                        active
                          ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30 font-medium"
                          : "bg-transparent text-tx-secondary border-app-border hover:border-tx-secondary"
                      )}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 底部操作工具栏 (紧挨着键盘上方右侧，屏幕底端对齐) */}
      <div className="p-3 bg-app-surface border-t border-app-border flex items-center justify-between shrink-0" style={{ paddingBottom: "calc(var(--safe-area-bottom) + 8px)" }}>
        {/* 左侧：可见性权限 */}
        <button
          onClick={() => setVisibility((v) => (v === "PRIVATE" ? "PUBLIC" : "PRIVATE"))}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all border border-app-border/60 bg-app-surface",
            visibility === "PUBLIC" ? "text-accent-primary border-accent-primary/20 bg-accent-primary/5" : "text-tx-secondary"
          )}
        >
          {visibility === "PUBLIC" ? (
            <>
              <Globe size={13} />
              <span>公开可见</span>
            </>
          ) : (
            <>
              <Lock size={13} />
              <span>自己可见</span>
            </>
          )}
        </button>

        {/* 右侧：标签、表情/心情、录音、拍照/上传 */}
        <div className="flex items-center gap-2">
          {/* 照片按钮 */}
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={images.length >= 9}
            className="p-2.5 rounded-xl text-tx-secondary hover:bg-app-hover disabled:opacity-40"
            title="添加图片"
          >
            <span className="text-base">📷</span>
          </button>

          {/* 标签按钮 */}
          <button
            onClick={() => {
              setShowTags(!showTags);
              setShowMoods(false);
            }}
            className={cn(
              "p-2.5 rounded-xl transition-colors",
              showTags ? "bg-accent-primary/15 text-accent-primary" : "text-tx-secondary hover:bg-app-hover"
            )}
            title="选择标签"
          >
            <TagIcon size={18} />
          </button>

          {/* 心情表情按钮 */}
          <button
            onClick={handleMoodBtnClick}
            className={cn(
              "p-2.5 rounded-xl transition-colors",
              showMoods || mood ? "bg-accent-primary/15 text-accent-primary" : "text-tx-secondary hover:bg-app-hover"
            )}
            title="添加心情表情"
          >
            <Smile size={18} />
          </button>

          {/* 录音按钮 */}
          <button
            onClick={handleRecordClick}
            disabled={voiceUploading || !!pendingVoice}
            className={cn(
              "p-2.5 rounded-xl transition-all duration-200",
              recording
                ? "bg-red-500 text-white animate-pulse"
                : pendingVoice
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "text-tx-secondary hover:bg-app-hover"
            )}
            title={recording ? "停止录音" : "点击录音"}
          >
            {recording && recordBlink ? (
              <span className="w-4 h-4 rounded-full bg-white block" />
            ) : (
              <Mic size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
