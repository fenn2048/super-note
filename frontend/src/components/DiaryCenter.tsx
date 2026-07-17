import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { EmojiPicker } from "./EmojiPicker";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Trash2,
  Loader2,
  ChevronDown,
  Smile,
  MessageCircle,
  ImagePlus,
  Image,
  X,
  Calendar,
  User as UserIcon,
  Edit2,
  Mic,
  Play,
  Pause,
  Volume2,
  Globe,
  Lock,
  Copy,
  VolumeX,
  Sparkles,
  Search,
  Star,
  Pin,
  MoreHorizontal,
  Heart,
  Video,
  Menu,
  ScanText,
  RotateCcw,
  Link,
  BookOpen,
} from "lucide-react";
import { api, getCurrentWorkspace, getBaseUrl, getServerUrl } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import { toast } from "@/lib/toast";
import { useScrollHideBars } from "@/hooks/useScrollHideBars";
import { Diary, DiaryStats, Tag, DiaryComment, User } from "@/types";
import { confirm as confirmDialog } from "@/components/ui/confirm";
import { cn, detectSuMention, getTagColor } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { haptic } from "@/hooks/useCapacitor";
import { registerPlugin } from "@capacitor/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Input } from "@/components/ui/input";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useApp, useAppActions } from "@/store/AppContext";
import TextareaFormatToolbar from "@/components/common/TextareaFormatToolbar";
import TagColorPopover from "@/components/TagColorPopover";
import GenericTagInput from "@/components/GenericTagInput";
import DiaryCalendar from "@/components/DiaryCalendar";
import DiaryHeatMap from "@/components/DiaryHeatMap";
import MentionPicker, { parseMentionTrigger, replaceMentionText, useMentionState } from "@/components/MentionPicker";
import RecordingPanel from "@/components/RecordingPanel";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import OCRModal from "@/components/OCRModal";


marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * 检测文本是否包含 Markdown 语法或 HTML 标签
 */
function hasMarkdownSyntax(text: string): boolean {
  return /(\*\*.*\*\*|#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|!\[.*\]\(|\[.*\]\(|`{1,3}|^>\s|<[a-zA-Z0-9]+[^>]*>)/m.test(text);
}

/**
 * 将 HTML 中的 iframe 转换为默认不播放、点击后才加载播放的占位框
 */
function transformIframesToClickToPlay(html: string): string {
  if (typeof window === "undefined") return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const iframes = doc.querySelectorAll("iframe");
    if (iframes.length === 0) return html;

    iframes.forEach((iframe) => {
      const src = iframe.getAttribute("src") || "";
      const attrs: Record<string, string> = {};
      for (let i = 0; i < iframe.attributes.length; i++) {
        const attr = iframe.attributes[i];
        attrs[attr.name] = attr.value;
      }

      const wrapper = doc.createElement("div");
      wrapper.className = "iframe-placeholder-wrapper my-4";
      wrapper.setAttribute("data-src", src);
      wrapper.setAttribute("data-attrs", JSON.stringify(attrs));

      // 占位框的行内样式
      wrapper.style.position = "relative";
      wrapper.style.cursor = "pointer";
      wrapper.style.width = "100%";
      wrapper.style.maxWidth = "640px";
      wrapper.style.aspectRatio = "16/9";
      wrapper.style.backgroundColor = "#0f172a";
      wrapper.style.borderRadius = "12px";
      wrapper.style.display = "flex";
      wrapper.style.flexDirection = "column";
      wrapper.style.alignItems = "center";
      wrapper.style.justifyContent = "center";
      wrapper.style.overflow = "hidden";
      wrapper.style.border = "1px solid rgba(255,255,255,0.1)";
      wrapper.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.3)";

      wrapper.innerHTML = `
        <div class="play-button" style="width: 56px; height: 56px; border-radius: 50%; background: rgba(255,255,255,0.15); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; border: 2px solid rgba(255,255,255,0.8); transition: transform 0.2s ease, background-color 0.2s ease; position: absolute; z-index: 2; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: translateX(1.5px);">
            <path d="M8 5V19L19 12L8 5Z" fill="#ffffff"/>
          </svg>
        </div>
      `;
      iframe.parentNode?.replaceChild(wrapper, iframe);
    });
    return doc.body.innerHTML;
  } catch (err) {
    console.error("Failed to parse iframe HTML:", err);
    return html;
  }
}

/**
 * 渲染说说内容：自动检测 Markdown/HTML 语法，有则渲染为 MD，无则显示纯文本。
 */
export function renderDiaryContent(text: string): string {
  if (!text) return "";
  const rawHtml = marked.parse(text) as string;
  const sanitized = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling", "sandbox", "src", "width", "height", "style"],
    ALLOWED_SCHEMES: ["http", "https", "ftp", "mailto", "tel", "data", "book", "book-note"],
  } as any).toString();
  return transformIframesToClickToPlay(sanitized);
}

export function renderTextWithLinks(text: string) {
  if (!text) return "";
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    if (match[1] && match[2]) {
      parts.push(
        <a 
          key={match.index} 
          href={match[2]} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          onClick={(e) => e.stopPropagation()}
        >
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      parts.push(
        <a 
          key={match.index} 
          href={match[3]} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          onClick={(e) => e.stopPropagation()}
        >
          {match[3]}
        </a>
      );
    }
    lastIndex = linkRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

/**
 * 递归高亮 HTML 文本节点中的搜索关键词（避开 pre、code、script、style 等节点）
 */
export function highlightHtmlKeyword(html: string, keyword?: string): string {
  if (!html) return "";
  if (!keyword || !keyword.trim()) return html;

  const trimmedKeyword = keyword.trim();
  const searchTerms = new Set<string>();
  searchTerms.add(trimmedKeyword);
  if (trimmedKeyword.startsWith("#")) {
    searchTerms.add(trimmedKeyword.slice(1));
  }

  const sortedTerms = Array.from(searchTerms)
    .filter((term) => term.length > 0)
    .sort((a, b) => b.length - a.length);

  if (sortedTerms.length === 0) return html;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const walk = (node: Node) => {
      const parentName = node.parentNode?.nodeName.toLowerCase();
      if (
        parentName === "script" ||
        parentName === "style" ||
        parentName === "pre" ||
        parentName === "code"
      ) {
        return;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue || "";
        if (!text.trim()) return;

        const escapeRegex = (s: string) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        const pattern = sortedTerms.map(escapeRegex).join("|");
        const regex = new RegExp(`(${pattern})`, "gi");

        if (regex.test(text)) {
          const parts = text.split(regex);
          const frag = doc.createDocumentFragment();

          parts.forEach((part) => {
            if (regex.test(part)) {
              const mark = doc.createElement("mark");
              mark.className =
                "bg-amber-500/20 dark:bg-amber-500/30 text-amber-950 dark:text-amber-100 font-semibold rounded px-0.5 mx-px border-b border-amber-500/40";
              mark.textContent = part;
              frag.appendChild(mark);
            } else if (part) {
              frag.appendChild(doc.createTextNode(part));
            }
          });

          node.parentNode?.replaceChild(frag, node);
        }
      } else {
        const children = Array.from(node.childNodes);
        children.forEach(walk);
      }
    };

    walk(doc.body);
    return doc.body.innerHTML;
  } catch (err) {
    console.error("Failed to highlight HTML keyword:", err);
    return html;
  }
}

// 心情选项
const MOODS = [
  { value: "happy", emoji: "😊" },
  { value: "excited", emoji: "🥳" },
  { value: "peaceful", emoji: "😌" },
  { value: "thinking", emoji: "🤔" },
  { value: "tired", emoji: "😴" },
  { value: "sad", emoji: "😢" },
  { value: "angry", emoji: "😤" },
  { value: "sick", emoji: "🤒" },
  { value: "love", emoji: "🥰" },
  { value: "cool", emoji: "😎" },
  { value: "laugh", emoji: "🤣" },
  { value: "shock", emoji: "😱" },
];


export const SU_USER_ID = "00000000-0000-0000-0000-000000000001";

function getMoodEmoji(mood: string): string {
  return MOODS.find((m) => m.value === mood)?.emoji || "";
}

// ---------------------------------------------------------------------------
// 图片相关常量与工具
// ---------------------------------------------------------------------------
// 单条说说图片数量上限。前端硬限制 + 后端 diary.ts 也限制，双保险。
const MAX_IMAGES_PER_DIARY = 9;
// 单张图大小上限，与后端 MAX_DIARY_IMAGE_SIZE 保持一致 → 不一致会出现"前端选过、后端拒"的尴尬
const MAX_DIARY_IMAGE_SIZE = 10 * 1024 * 1024;
// 与后端 ALLOWED_DIARY_IMAGE_MIMES 对齐（不收 svg 防 XSS）
const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

// 相对时间显示
function timeAgo(dateStr: string, t: (key: string) => string): string {
  const now = new Date();
  const date = new Date(dateStr.replace(" ", "T") + "Z");
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return t("diary.justNow");
  if (diffMin < 60) return t("diary.minutesAgo").replace("{{n}}", String(diffMin));
  if (diffHour < 24) return t("diary.hoursAgo").replace("{{n}}", String(diffHour));
  if (diffDay < 7) return t("diary.daysAgo").replace("{{n}}", String(diffDay));

  // 超过 7 天显示具体日期
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  if (y === now.getFullYear()) return `${m}-${d} ${h}:${min}`;
  return `${y}-${m}-${d} ${h}:${min}`;
}

// ---------------------------------------------------------------------------
// 待上传 / 上传中 / 上传失败的本地图片项
//   - id 为 null 表示尚未上传成功（仍只在本地）
//   - previewUrl 用 URL.createObjectURL 生成；卸载时 revoke 防内存泄漏
//   - status: 控制缩略图上的 spinner / 错误覆盖层
// ---------------------------------------------------------------------------
interface PendingImage {
  /** 本地随机 key，用于 React 列表渲染 + 删除定位 */
  localKey: string;
  /** 上传成功后的服务端 id；上传中 / 失败为 null */
  id: string | null;
  /** 本地预览（blob:），上传成功后保留此预览（无需重新拉远端图） */
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  errorMessage?: string;
  type?: "image" | "video";
}

const subscribeToAiTaskSSE = (taskId: string, onComplete: (result: any) => void) => {
  const token = localStorage.getItem("super-token") || "";
  const baseUrl = getBaseUrl();
  const eventSource = new EventSource(`${baseUrl}/ai/tasks/${taskId}/stream?token=${encodeURIComponent(token)}`);

  eventSource.addEventListener("completed", (event: any) => {
    try {
      const data = JSON.parse(event.data);
      eventSource.close();
      onComplete(data);
    } catch (err) {
      console.error("Failed to parse AI task SSE data:", err);
    }
  });

  eventSource.addEventListener("failed", (event: any) => {
    eventSource.close();
    toast.error(event.data || "AI 助手生成回复失败");
  });

  eventSource.onerror = (err) => {
    console.error("SSE Connection error:", err);
    eventSource.close();
  };
};

// ============================================================
// 发布框
// ============================================================
function ComposeBox({ onPost }: { onPost: () => void }) {
  const { t } = useTranslation();
  const { state } = useApp();
  const [text, setText] = useState("");
  const [mood, setMood] = useState("");
  const [showMoods, setShowMoods] = useState(false);
  const [posting, setPosting] = useState(false);
  // 拖拽视觉反馈（dragOver 时高亮整个卡片）
  const [isDragging, setIsDragging] = useState(false);
  // 待发布图片队列。用 ref 留一份镜像，因为粘贴 / 拖拽回调里要拿到最新值再
  // setState，避免函数式更新里反复读旧 state 计数错误。
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  pendingImagesRef.current = pendingImages;

  // 新增：可见性选择（工作区默认公开，个人空间默认私密）
  const [visibility, setVisibility] = useState<string>(() => {
    const ws = getCurrentWorkspace();
    return (ws && ws !== "personal") ? "PUBLIC" : "PRIVATE";
  });
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
  const visibilityRef = useRef<HTMLDivElement>(null);
  const [pendingVoice, setPendingVoice] = useState<{ id: string; duration: number } | null>(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [composeTags, setComposeTags] = useState<Tag[]>([]);
  const [showOCRModal, setShowOCRModal] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [originalTextBeforeAI, setOriginalTextBeforeAI] = useState("");
  const [showUndoButton, setShowUndoButton] = useState(false);
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const mediaMenuRef = useRef<HTMLDivElement>(null);

  const handleAIFormat = async () => {
    if (!text.trim()) {
      toast.error("请输入说说内容后再进行整理");
      return;
    }
    setFormatting(true);
    setOriginalTextBeforeAI(text);
    try {
      const formatted = await api.formatDiaryText(text);
      setText(formatted);
      setShowUndoButton(true);
      toast.success("AI 整理完成");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "AI 整理失败");
    } finally {
      setFormatting(false);
    }
  };

  const handleUndoAIFormat = () => {
    setText(originalTextBeforeAI);
    setShowUndoButton(false);
    toast.success("已恢复原文");
  };

  // @提及选择器状态
  const [cursorPos, setCursorPos] = useState(0);
  const mentionRaw = parseMentionTrigger(text, cursorPos);
  const mentionTrigger = mentionRaw ? { ...mentionRaw, clear: () => {} } : null;

  const [isFocused, setIsFocused] = useState(false);
  const handleAddTag = useCallback((tagName: string) => {
    haptic.light();
    const formattedTag = `#${tagName} `;
    if (!text.includes(formattedTag)) {
      setText((prev) => prev + (prev.endsWith(" ") || prev === "" ? "" : " ") + formattedTag);
    }
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  }, [text]);

  // 录音相关状态
  const [recording, setRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [recordingWaveform, setRecordingWaveform] = useState<number[]>(new Array(20).fill(0.1));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval>>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const waveformAnimRef = useRef<number>(0);

  const cleanupRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = undefined;
    }
    if (waveformAnimRef.current) {
      cancelAnimationFrame(waveformAnimRef.current);
      waveformAnimRef.current = 0;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setRecordDuration(0);
    setRecordingWaveform(new Array(20).fill(0.1));
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // On Android: request native mic permission through plugin first.
      if (
        typeof window !== "undefined" &&
        (window as any).Capacitor?.getPlatform?.() === "android"
      ) {
        try {
          const AppPermissions = registerPlugin<any>("AppPermissions");
          const micRes = await AppPermissions.requestMicrophonePermission();
          if (!micRes.granted) {
            toast.error("需要麦克风权限才能使用录音功能，请在系统设置中授予权限");
            return;
          }
        } catch (permErr) {
          console.warn("Capacitor mic permission plugin unavailable:", permErr);
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 创建 AudioContext + AnalyserNode 用于波形可视化
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      // 启动波形动画循环
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const waveformValues = new Array(20).fill(0.1);
      const loop = () => {
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < 20; i++) {
          waveformValues[i] = dataArray[i] / 255;
        }
        setRecordingWaveform([...waveformValues]);
        waveformAnimRef.current = requestAnimationFrame(loop);
      };
      loop();

      // 创建 MediaRecorder（与 AnalyserNode 共享同一个 stream）
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      haptic.light();
      recordingStartTimeRef.current = Date.now();
      setRecording(true);
      setRecordDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordDuration(Math.floor((Date.now() - recordingStartTimeRef.current) / 1000));
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
      toast.error("无法启动录音，请检查麦克风权限");
    }
  }, []);

  const stopRecordingAndGetBlob = useCallback(async (): Promise<{ blob: Blob; duration: number }> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        reject(new Error("No active recording"));
        return;
      }

      const duration = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000);

      recorder.addEventListener("stop", () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        cleanupRecording();
        resolve({ blob, duration: duration || 1 });
      }, { once: true });

      recorder.stop();
      haptic.medium();
    });
  }, [cleanupRecording]);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.addEventListener("stop", () => {
        audioChunksRef.current = [];
      }, { once: true });
      recorder.stop();
    }
    cleanupRecording();
    setRecording(false);
  }, [cleanupRecording]);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const moodRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const addVideoFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const current = pendingImagesRef.current;
      const remaining = MAX_IMAGES_PER_DIARY - current.length;
      if (remaining <= 0) return;

      const accepted: File[] = [];
      const rejected: { name: string; reason: string }[] = [];
      for (const f of files) {
        if (accepted.length >= remaining) break;
        const mime = (f.type || "").toLowerCase();
        const isVideo = mime.startsWith("video/");
        if (!isVideo) {
          rejected.push({ name: f.name || "video", reason: "type" });
          continue;
        }
        if (f.size > MAX_DIARY_IMAGE_SIZE) {
          rejected.push({ name: f.name || "video", reason: "size" });
          continue;
        }
        accepted.push(f);
      }
      if (rejected.length) {
        const lines = rejected.map((r) =>
          r.reason === "size"
            ? `视频文件太大 (不超过 10MB): ${r.name}`
            : `不支持的视频类型: ${r.name}`,
        );
        for (const line of lines) toast.error(line);
      }
      if (!accepted.length) return;

      const newItems: PendingImage[] = accepted.map((f) => ({
        localKey: crypto.randomUUID(),
        id: null,
        previewUrl: URL.createObjectURL(f),
        status: "uploading",
        type: "video" as const,
      }));
      setPendingImages((prev) => [...prev, ...newItems]);

      newItems.forEach((item, idx) => {
        const file = accepted[idx];
        api.diaryImages
          .upload(file)
          .then((res) => {
            setPendingImages((prev) =>
              prev.map((p) =>
                p.localKey === item.localKey
                  ? { ...p, id: res.id, status: "ready" as const }
                  : p,
              ),
            );
          })
          .catch((err) => {
            console.error("Diary video upload failed:", err);
            setPendingImages((prev) =>
              prev.map((p) =>
                p.localKey === item.localKey
                  ? {
                      ...p,
                      status: "error" as const,
                      errorMessage: err?.message || "upload failed",
                    }
                  : p,
              ),
            );
          });
      });
    },
    [],
  );

  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    void addVideoFiles(files);
    e.target.value = "";
  };

  // dragOver/Leave 计数：浏览器会在子元素切换时狂抛 enter/leave 事件，
  // 直接 setState 会闪烁。用计数器保证只有真正离开容器才隐藏高亮。
  const dragCounterRef = useRef(0);

  // 自动调整 textarea 高度
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 300) + "px";
    }
  }, []);

  // 点击外部关闭心情选择器
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moodRef.current && !moodRef.current.contains(e.target as Node)) {
        setShowMoods(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 点击外部关闭媒体选择菜单
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (mediaMenuRef.current && !mediaMenuRef.current.contains(target)) {
        setIsMediaMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  // 点击外部关闭可见性选择菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (visibilityRef.current && !visibilityRef.current.contains(e.target as Node)) {
        setShowVisibilityMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 卸载时回收所有 blob URL
  useEffect(() => {
    return () => {
      for (const item of pendingImagesRef.current) {
        try {
          URL.revokeObjectURL(item.previewUrl);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // 添加文件到上传队列（共用入口：input change / 粘贴 / 拖拽 都走这里）
  //   - 校验 MIME 与大小，把不合规的剔掉并告知用户（这里用 alert 简单兜底；
  //     如果项目有全局 toast 可以替换）
  //   - 受 MAX_IMAGES_PER_DIARY 卡上限，超出部分静默丢弃
  // -------------------------------------------------------------------------
  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const current = pendingImagesRef.current;
      const remaining = MAX_IMAGES_PER_DIARY - current.length;
      if (remaining <= 0) return;

      const accepted: File[] = [];
      const rejected: { name: string; reason: string }[] = [];
      for (const f of files) {
        if (accepted.length >= remaining) break;
        const mime = (f.type || "").toLowerCase();
        if (!ALLOWED_IMAGE_MIMES.has(mime)) {
          rejected.push({ name: f.name || "image", reason: "type" });
          continue;
        }
        if (f.size > MAX_DIARY_IMAGE_SIZE) {
          rejected.push({ name: f.name || "image", reason: "size" });
          continue;
        }
        accepted.push(f);
      }
      if (rejected.length) {
        // 多条拒绝原因逐条 toast：保持视觉一致，避免原生 alert 的尴尬抬头
        const lines = rejected.map((r) =>
          r.reason === "size"
            ? t("diary.imageTooLarge").replace("{{name}}", r.name)
            : t("diary.imageTypeUnsupported").replace("{{name}}", r.name),
        );
        for (const line of lines) toast.error(line);
      }
      if (!accepted.length) return;

      // 先把"上传中"占位丢进 state，UI 立刻有反馈；逐个并发上传更新各自状态。
      const newItems: PendingImage[] = accepted.map((f) => ({
        localKey: crypto.randomUUID(),
        id: null,
        previewUrl: URL.createObjectURL(f),
        status: "uploading",
      }));
      setPendingImages((prev) => [...prev, ...newItems]);

      // 并发上传；每张图独立处理结果（部分失败不影响其他图）
      newItems.forEach((item, idx) => {
        const file = accepted[idx];
        api.diaryImages
          .upload(file)
          .then((res) => {
            setPendingImages((prev) =>
              prev.map((p) =>
                p.localKey === item.localKey
                  ? { ...p, id: res.id, status: "ready" as const }
                  : p,
              ),
            );
          })
          .catch((err) => {
            console.error("Diary image upload failed:", err);
            setPendingImages((prev) =>
              prev.map((p) =>
                p.localKey === item.localKey
                  ? {
                      ...p,
                      status: "error" as const,
                      errorMessage: err?.message || "upload failed",
                    }
                  : p,
              ),
            );
          });
      });
    },
    [t],
  );

  // 移除一张图：未上传成功的直接丢；已上传成功的同时调后端 DELETE 释放服务端文件
  const removeImage = useCallback((localKey: string) => {
    const target = pendingImagesRef.current.find((p) => p.localKey === localKey);
    if (!target) return;
    setPendingImages((prev) => prev.filter((p) => p.localKey !== localKey));
    try {
      URL.revokeObjectURL(target.previewUrl);
    } catch {
      /* ignore */
    }
    if (target.id && target.status === "ready") {
      // 后端会校验"未绑定 diary"才允许删；此处出错忽略即可（最坏情况是个孤儿，
      // 24h 后被 sweepOrphanDiaryImages 清理）。
      api.diaryImages.remove(target.id).catch(() => {
        /* ignore */
      });
    }
  }, []);

  // 文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    void addFiles(files);
    // 清空 value，下次选同一张图也能触发 change
    e.target.value = "";
  };

  // 粘贴：从剪贴板里抓出图片文件
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault(); // 阻止默认（防止把 [object File] 文本塞进去）
      void addFiles(files);
    }
  };

  // 拖拽
  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length) void addFiles(files);
  };

  // 处理语音上传
  const handleVoiceUpload = async (file: File, duration: number) => {
    try {
      setVoiceUploading(true);
      const uploadRes = await api.diaryImages.upload(file);
      setPendingVoice({
        id: uploadRes.id,
        duration: duration || 1,
      });
    } catch (e) {
      console.error("Voice upload failed:", e);
      toast.error("语音上传失败");
    } finally {
      setVoiceUploading(false);
    }
  };

  const handleDeleteVoice = useCallback(() => {
    if (!pendingVoice) return;
    api.diaryImages.remove(pendingVoice.id).catch(() => {});
    setPendingVoice(null);
  }, [pendingVoice]);

  const hasPendingUploads = pendingImages.some((p) => p.status === "uploading");
  const hasErrorImages = pendingImages.some((p) => p.status === "error");
  const readyImageIds = pendingImages
    .filter((p) => p.status === "ready" && p.id)
    .map((p) => p.id!) as string[];

  // 提交条件：内容、图片、语音至少一项，且没有上传中
  const canSubmit =
    !posting &&
    !hasPendingUploads &&
    !voiceUploading &&
    (text.trim().length > 0 || readyImageIds.length > 0 || pendingVoice !== null);

  const handlePost = async () => {
    if (!canSubmit) return;

    // === AI @su 检测 ===
    const su = detectSuMention(text.trim());
    if (su.hasSu) {
      // 立即 toast + 清空输入框，不阻塞 UI
      toast.success("AI 助手正在处理，请稍后查看");
      haptic.success();
      for (const item of pendingImagesRef.current) {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
      }
      setText("");
      setMood("");
      setShowMoods(false);
      setPendingImages([]);
      setVisibility(getCurrentWorkspace() !== "personal" ? "PUBLIC" : "PRIVATE");
      setPendingVoice(null);
      setComposeTags([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      // 后台异步执行，不阻塞发布按钮
      api.diaryAiAsk({ mode: "post", question: su.cleanText })
        .then((res: any) => {
          if (res && res.taskId) {
            subscribeToAiTaskSSE(res.taskId, () => {
              onPost();
              toast.success("AI 助手说说发布成功");
            });
          } else {
            onPost();
          }
        })
        .catch((err) => {
          console.error("AI ask failed:", err);
          toast.error(err?.message || "AI 助手请求失败");
        });
      return;
    }
    // === 普通发布逻辑 ===
    setPosting(true);
    try {
      await api.postDiary({
        contentText: text.trim(),
        mood,
        images: readyImageIds,
        visibility,
        voice: pendingVoice,
        tagIds: composeTags.map((t) => t.id),
      });
      haptic.success();
      for (const item of pendingImagesRef.current) {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
      }
      setText("");
      setMood("");
      setShowMoods(false);
      setPendingImages([]);
      setVisibility(getCurrentWorkspace() !== "personal" ? "PUBLIC" : "PRIVATE");
      setPendingVoice(null);
      setComposeTags([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      onPost();
    } catch (e) {
      console.error("Post failed:", e);
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + Enter 发布
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handlePost();
    }
  };

  const selectedMoodEmoji = getMoodEmoji(mood);
  const remainingSlots = MAX_IMAGES_PER_DIARY - pendingImages.length;

  return (
    <div
      className={cn(
        "bg-app-surface border border-app-border/40 rounded-xl p-4 shadow-sm transition-all",
        isDragging && "ring-2 ring-accent-primary/50 border-accent-primary/40",
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 输入区域 */}
      <div className="relative border border-app-border/80 bg-app-bg dark:bg-[#121214] rounded-lg p-2.5 transition-all mb-3 focus-within:border-accent-primary/40 focus-within:ring-1 focus-within:ring-accent-primary/10">
        {showFormatToolbar && (
          <TextareaFormatToolbar
            textareaRef={textareaRef}
            value={text}
            onChange={setText}
          />
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCursorPos(e.target.selectionStart);
            autoResize();
            if (showUndoButton) setShowUndoButton(false);
          }}
          onSelect={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
          onClick={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyUp={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={(e) => {
            if (mentionTrigger) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
              }
            }
            handleKeyDown(e);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          onPaste={handlePaste}
          placeholder="分享新鲜事..."
          className="w-full bg-transparent text-tx-primary placeholder:text-tx-tertiary text-xs leading-relaxed resize-none outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 border-none no-focus-ring transition-all duration-300 min-h-[64px]"
        />
      </div>

      {/* @提及选择器 */}
      {mentionTrigger && (
        <div className="relative z-50">
          <MentionPicker
            search={mentionTrigger.search}
            onSelect={(user) => {
              const newText = replaceMentionText(text, cursorPos, mentionTrigger.startIndex, user.username);
              setText(newText);
              setCursorPos(mentionTrigger.startIndex + user.username.length + 2);
              mentionTrigger.clear();
              textareaRef.current?.focus();
            }}
            onClose={mentionTrigger.clear}
          />
        </div>
      )}

      {/* 待发布媒体缩略图区 */}
      {pendingImages.length > 0 && (
        <div className="mt-2 grid grid-cols-4 sm:grid-cols-5 gap-2">
          {pendingImages.map((img) => (
            <div
              key={img.localKey}
              className="relative aspect-square rounded-lg overflow-hidden border border-app-border bg-app-hover/40 group/img"
            >
              {img.type === "video" ? (
                <video
                  src={img.previewUrl}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={img.previewUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  draggable={false}
                />
              )}
              {/* 上传中遮罩 */}
              {img.status === "uploading" && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 size={18} className="animate-spin text-white" />
                </div>
              )}
              {/* 上传失败遮罩 */}
              {img.status === "error" && (
                <div
                  className="absolute inset-0 bg-red-500/60 flex items-center justify-center text-[10px] text-white text-center px-1"
                  title={img.errorMessage}
                >
                  {t("diary.uploadFailed")}
                </div>
              )}
              {/* 删除按钮 */}
              <button
                type="button"
                onClick={() => removeImage(img.localKey)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                aria-label={t("diary.removeImage")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 语音上传中 */}
      {voiceUploading && (
        <div className="mt-2.5 p-3 rounded-xl bg-app-hover/40 border border-app-border flex items-center gap-2">
          <Loader2 size={16} className="animate-spin text-accent-primary" />
          <span className="text-xs text-tx-tertiary">语音上传中...</span>
        </div>
      )}

      {/* 已录制语音预览 */}
      {pendingVoice && (
        <div className="mt-2.5 p-3 rounded-xl bg-accent-primary/5 border border-accent-primary/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-primary/10 flex items-center justify-center text-accent-primary">
              <Mic size={16} />
            </div>
            <div>
              <span className="text-xs font-semibold text-tx-primary">已录制语音</span>
              <span className="text-[10px] text-tx-tertiary block mt-0.5 tabular-nums">
                {Math.floor(pendingVoice.duration / 60)}分{pendingVoice.duration % 60}秒
              </span>
            </div>
          </div>
          
          <button
            onClick={handleDeleteVoice}
            className="w-6 h-6 rounded-full bg-black/5 hover:bg-black/10 text-tx-secondary flex items-center justify-center transition-all"
            aria-label="删除录音"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 常用标签与标签选择器 - 在聚焦或有内容时展开 */}
      {(isFocused || text.length > 0 || pendingImages.length > 0 || pendingVoice !== null) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden mt-3 space-y-3"
        >
          {/* 常用标签推荐 */}
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            <span className="text-[11px] text-tx-tertiary mr-1 font-medium">推荐标签:</span>
            {((state.tags && state.tags.length > 0) ? state.tags.slice(0, 5) : [
              { id: "1", name: "日记" },
              { id: "2", name: "想法" },
              { id: "3", name: "工作" },
              { id: "4", name: "学习" },
              { id: "5", name: "生活" }
            ]).map((tag: any) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleAddTag(tag.name)}
                className="text-[11px] px-2 py-0.5 rounded-full bg-app-hover hover:bg-accent-primary/10 hover:text-accent-primary text-tx-secondary transition-all"
              >
                #{tag.name}
              </button>
            ))}
          </div>

          {/* 标签选择 */}
          <GenericTagInput
            selectedTags={composeTags}
            onTagsChange={setComposeTags}
            placeholder={t('tags.addTagPlaceholder')}
          />
        </motion.div>
      )}

      {/* 录音面板 - 覆盖底部操作栏 */}
      <AnimatePresence>
        {recording && (
          <RecordingPanel
            duration={recordDuration}
            waveformData={recordingWaveform}
            onRecordingComplete={async () => {
              // 处理录音完成
              try {
                const { blob, duration } = await stopRecordingAndGetBlob();
                if (blob.size > 0) {
                  // 去掉 codecs 后缀（如 "audio/webm;codecs=opus" → "audio/webm"），后端做 Set.has 精确匹配
                  const cleanMime = blob.type.split(";")[0].trim();
                  const file = new File([blob], "voice.webm", { type: cleanMime });
                  handleVoiceUpload(file, duration);
                }
              } catch (e) {
                console.error("Recording complete error:", e);
              }
              setRecording(false);
            }}
            onCancel={() => {
              cancelRecording();
              setRecording(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* 底部操作栏 - 录音时隐藏 */}
      {!recording && (
        <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
          {/* 左侧：媒体 + 格式 A + AI整理 */}
          <div className="flex items-center gap-1.5">
            {/* 媒体按钮及其浮层 */}
            <div className="relative" ref={mediaMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setIsMediaMenuOpen(!isMediaMenuOpen);
                }}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] transition-all border border-app-border bg-app-surface font-medium",
                  isMediaMenuOpen ? "bg-accent-primary/15 text-accent-primary border-accent-primary/20" : "text-tx-secondary"
                )}
                title="选择媒体文件"
              >
                <Image size={14} className="text-tx-secondary" />
                <span>媒体</span>
              </button>
              <AnimatePresence>
                {isMediaMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-7 left-0 bg-app-surface border border-app-border shadow-lg rounded-xl p-1 z-50 w-32 flex flex-col"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsMediaMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-tx-primary hover:bg-app-hover rounded transition-colors text-left"
                    >
                      <Image size={14} className="text-tx-secondary" />
                      <span>图片</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMediaMenuOpen(false);
                        videoInputRef.current?.click();
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-tx-primary hover:bg-app-hover rounded transition-colors text-left"
                    >
                      <Video size={14} className="text-tx-secondary" />
                      <span>视频</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMediaMenuOpen(false);
                        startRecording();
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-tx-primary hover:bg-app-hover rounded transition-colors text-left"
                    >
                      <Mic size={14} className="text-tx-secondary" />
                      <span>语音</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMediaMenuOpen(false);
                        setShowOCRModal(true);
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-tx-primary hover:bg-app-hover rounded transition-colors text-left"
                    >
                      <ScanText size={14} className="text-tx-secondary" />
                      <span>OCR</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 格式 A 按钮 */}
            <button
              type="button"
              onClick={() => setShowFormatToolbar(!showFormatToolbar)}
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-md transition-colors font-bold text-xs",
                showFormatToolbar ? "bg-accent-primary/15 text-accent-primary" : "text-tx-secondary hover:bg-app-hover"
              )}
              title="排版格式"
            >
              A
            </button>

            {/* AI 整理 */}
            {showUndoButton ? (
              <button
                type="button"
                onClick={handleUndoAIFormat}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-amber-600 hover:text-amber-700 bg-amber-500/10 hover:bg-amber-500/20 dark:text-amber-400 dark:hover:text-amber-300 dark:bg-amber-500/20 transition-all font-semibold"
                title="恢复到 AI 整理前的原始内容"
              >
                <RotateCcw size={14} className="text-amber-500" />
                <span>撤销</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleAIFormat}
                disabled={!text.trim() || formatting}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-all font-semibold",
                  text.trim() && !formatting
                    ? "text-accent-primary hover:bg-accent-primary/10 active:bg-accent-primary/20"
                    : "text-tx-tertiary/50 cursor-not-allowed"
                )}
                title="使用 AI 自动整理排版"
              >
                <Sparkles size={14} className={text.trim() && !formatting ? "text-accent-primary animate-pulse" : "text-tx-tertiary/50"} />
                <span>AI 整理</span>
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/ogg"
              multiple
              className="hidden"
              onChange={handleVideoFileChange}
            />

            <OCRModal
              isOpen={showOCRModal}
              onClose={() => setShowOCRModal(false)}
              onInsert={(recognizedText) => {
                if (textareaRef.current) {
                  const start = textareaRef.current.selectionStart;
                  const end = textareaRef.current.selectionEnd;
                  const newText = text.substring(0, start) + "\n" + recognizedText + "\n" + text.substring(end);
                  setText(newText);
                  setTimeout(() => {
                    if (textareaRef.current) {
                      textareaRef.current.dispatchEvent(new Event("input", { bubbles: true }));
                    }
                  }, 50);
                } else {
                  setText(prev => prev + "\n" + recognizedText);
                }
              }}
            />
          </div>

          {/* 右侧：可见性 + 字数 + 发布 */}
          <div className="flex items-center gap-2">
            {/* 可见性范围选择 - 个人空间无需选择 */}
            {getCurrentWorkspace() !== "personal" && (
              <div className="relative" ref={visibilityRef}>
                <button
                  type="button"
                  onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[#eaebec]/60 dark:bg-white/5 hover:bg-[#eaebec] dark:hover:bg-white/10 text-tx-secondary transition-all"
                >
                  {visibility === "PUBLIC" ? (
                    <>
                      <Globe size={11} className="opacity-70" />
                      <span>公开</span>
                    </>
                  ) : (
                    <>
                      <Lock size={11} className="opacity-70" />
                      <span>仅自己可见</span>
                    </>
                  )}
                  <ChevronDown size={11} className="opacity-60" />
                </button>
                <AnimatePresence>
                  {showVisibilityMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 5 }}
                      className="absolute bottom-full mb-1 right-0 bg-app-surface border border-app-border shadow-lg rounded-lg py-1 z-50 w-32"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setVisibility("PUBLIC");
                          setShowVisibilityMenu(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors",
                          visibility === "PUBLIC"
                            ? "bg-accent-primary/10 text-accent-primary font-medium"
                            : "text-tx-secondary hover:bg-app-hover"
                        )}
                      >
                        <Globe size={11} />
                        <span>公开</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVisibility("PRIVATE");
                          setShowVisibilityMenu(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors",
                          visibility === "PRIVATE"
                            ? "bg-accent-primary/10 text-accent-primary font-medium"
                            : "text-tx-secondary hover:bg-app-hover"
                        )}
                      >
                        <Lock size={11} />
                        <span>仅自己可见</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 字数计数 */}
            {text.length > 0 && (
              <span
                className={cn(
                  "text-[10px] tabular-nums transition-colors",
                  text.length > 500 ? "text-red-400" : "text-tx-tertiary",
                )}
              >
                {text.length}
              </span>
            )}

            {/* 发布按钮 */}
            <button
              onClick={handlePost}
              disabled={!canSubmit}
              className={cn(
                "flex items-center justify-center px-4 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95",
                canSubmit
                  ? "bg-[#5b51da] hover:bg-[#483ec7] text-white shadow-sm"
                  : "bg-app-hover text-tx-tertiary cursor-not-allowed opacity-50",
              )}
              title={
                hasPendingUploads
                  ? t("diary.waitingUpload")
                  : hasErrorImages
                    ? t("diary.errorImagesHint")
                    : undefined
              }
            >
              {posting ? (
                <Loader2 size={12} className="animate-spin text-white" />
              ) : (
                <span>发布</span>
              )}
            </button>
          </div>
        </div>
      )}
      {formatting && (
        <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center gap-3 animate-in fade-in duration-200">
          <div className="bg-app-elevated border border-app-border rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-3.5 max-w-xs text-center">
            <Loader2 size={32} className="animate-spin text-accent-primary" />
            <div>
              <p className="text-sm font-semibold text-tx-primary">AI 正在整理中...</p>
              <p className="text-xs text-tx-tertiary mt-1">智能梳理并总结您输入的内容</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 图片宫格 + Lightbox
// ============================================================
/**
 * 朋友圈风格的图片网格：
 *   1 张  → 单张大图（最大宽度，按比例显示）
 *   2~4 张 → 2 列
 *   5+ 张 → 3 列
 * 点击任意一张打开 Lightbox 大图查看，支持左右切换 / Esc 关闭。
 */
function ImageGrid({
  ids,
  attachments = [],
  onOpen,
}: {
  ids: string[];
  attachments?: { id: string; mimeType: string }[];
  onOpen: (idx: number) => void;
}) {
  if (!ids.length) return null;
  const count = ids.length;
  const cols = count === 1 ? 1 : (count === 2 || count === 4) ? 2 : 3;
  return (
    <div
      className={cn(
        "mt-3 grid gap-1.5 max-w-[66.7%]",
        cols === 1 && "grid-cols-1",
        cols === 2 && "grid-cols-2",
        cols === 3 && "grid-cols-3",
      )}
    >
      {ids.map((id, i) => {
        const att = attachments.find((a) => a.id === id);
        const isVideo = att && att.mimeType && att.mimeType.startsWith("video/");
        return (
          <button
            key={id}
            onClick={() => onOpen(i)}
            className={cn(
              "relative overflow-hidden rounded-lg border border-app-border bg-app-hover/30 hover:opacity-90 transition-opacity",
              // 单图按宽高自然比；多图统一正方形避免参差
              count === 1 ? "max-h-[213px]" : "aspect-square",
            )}
          >
            {isVideo ? (
              <div className="w-full h-full relative flex items-center justify-center bg-black">
                <video
                  src={api.diaryImages.urlFor(id)}
                  className={cn(
                    "w-full h-full pointer-events-none",
                    count === 1 ? "object-contain" : "object-cover",
                  )}
                  muted
                  playsInline
                />
                <div className="absolute w-10 h-10 rounded-full bg-black/55 flex items-center justify-center text-white">
                  <Play size={18} fill="white" className="ml-0.5" />
                </div>
              </div>
            ) : (
              <img
                src={api.diaryImages.urlFor(id)}
                alt=""
                loading="lazy"
                className={cn(
                  "w-full h-full",
                  count === 1 ? "object-contain" : "object-cover",
                )}
                draggable={false}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 简版 Lightbox：黑底全屏、左右箭头、Esc 关闭、点击空白关闭。
 * 没有引入第三方库（项目里没看到 lightbox 库），自己 60 行搞定足够。
 */
function Lightbox({
  ids,
  attachments = [],
  index,
  onClose,
  onIndexChange,
}: {
  ids: string[];
  attachments?: { id: string; mimeType: string }[];
  index: number;
  onClose: () => void;
  onIndexChange: (idx: number) => void;
}) {
  // 键盘控制
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      else if (e.key === "ArrowRight" && index < ids.length - 1)
        onIndexChange(index + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, ids.length, onClose, onIndexChange]);

  // 打开时禁滚（防止背景滚动）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!ids.length) return null;
  const id = ids[index];
  const att = attachments.find((a) => a.id === id);
  const isVideo = att && att.mimeType && att.mimeType.startsWith("video/");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
        aria-label="close"
      >
        <X size={20} />
      </button>
      {/* 左 / 右切换 */}
      {index > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index - 1);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
          aria-label="prev"
        >
          ‹
        </button>
      )}
      {index < ids.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index + 1);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
          aria-label="next"
        >
          ›
        </button>
      )}
      {/* 媒体本体：阻止冒泡，避免点/播放也关闭 */}
      {isVideo ? (
        <video
          key={id}
          src={api.diaryImages.urlFor(id)}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          className="max-w-[92vw] max-h-[88vh] object-contain"
        />
      ) : (
        <img
          key={id}
          src={api.diaryImages.urlFor(id)}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="max-w-[92vw] max-h-[88vh] object-contain"
          draggable={false}
        />
      )}
      {/* 计数 */}
      {ids.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/10 text-white text-xs tabular-nums">
          {index + 1} / {ids.length}
        </div>
      )}
    </motion.div>
  );
}

// ============================================================
// 语音播放器组件 (VoicePlayer)
// ============================================================
function VoicePlayer({
  item,
  onUpdate,
}: {
  item: Diary;
  onUpdate: (updated: Diary) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.voice?.duration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voice = item.voice!;
  const audioUrl = api.diaryImages.urlFor(voice.id);

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
      audioRef.current.playbackRate = playbackRate;
    }
  }, [volume, isMuted, playbackRate]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch((err) => {
        console.error("Play failed:", err);
      });
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (val > 0) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const cycleSpeed = () => {
    const rates = [1, 1.25, 1.5, 2, 0.5];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    setPlaybackRate(rates[nextIdx]);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col gap-2 w-full mt-3">
      {/* Equalizer animation style */}
      <style>{`
        @keyframes eq-bounce-1 {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        @keyframes eq-bounce-2 {
          0%, 100% { transform: scaleY(0.6); }
          50% { transform: scaleY(0.2); }
          75% { transform: scaleY(0.9); }
        }
        @keyframes eq-bounce-3 {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(0.8); }
        }
        .eq-bar-1 { animation: eq-bounce-1 0.8s ease-in-out infinite; transform-origin: bottom; }
        .eq-bar-2 { animation: eq-bounce-2 0.7s ease-in-out infinite; transform-origin: bottom; }
        .eq-bar-3 { animation: eq-bounce-3 0.9s ease-in-out infinite; transform-origin: bottom; }
      `}</style>

      {/* 播放器面板 */}
      <div
        className="relative overflow-hidden flex items-center gap-3 p-3 rounded-lg bg-accent-primary/5 border border-accent-primary/10 select-none hover:bg-accent-primary/10 transition-colors duration-200"
      >
        {/* 播放/暂停按钮 */}
        <button
          onClick={togglePlay}
          className="w-9 h-9 rounded-full bg-accent-primary text-white flex items-center justify-center shadow-md shadow-accent-primary/20 hover:scale-105 active:scale-95 transition-all shrink-0 z-10"
        >
          {isPlaying ? (
            <Pause size={20} fill="white" />
          ) : (
            <Play size={20} fill="white" className="ml-0.5" />
          )}
        </button>

        {/* 进度条 & 时间 */}
        <div className="flex-1 flex flex-col gap-1 min-w-0 z-10">
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 bg-app-border rounded-lg appearance-none cursor-pointer accent-accent-primary"
          />
          <div className="flex items-center justify-between text-[10px] text-tx-tertiary tabular-nums">
            <div className="flex items-center gap-1.5">
              <span>{formatTime(currentTime)}</span>
              {isPlaying && (
                <div className="flex items-end gap-[1.5px] h-3 w-3 pb-[1.5px]">
                  <div className="w-[1.5px] h-3 bg-accent-primary rounded-full eq-bar-1" />
                  <div className="w-[1.5px] h-3 bg-accent-primary rounded-full eq-bar-2" />
                  <div className="w-[1.5px] h-3 bg-accent-primary rounded-full eq-bar-3" />
                </div>
              )}
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* 音量控制 - 始终可见且紧凑 */}
        <div className="flex items-center gap-1 z-10 shrink-0">
          <button
            onClick={toggleMute}
            className="w-7 h-7 rounded-lg hover:bg-app-hover text-tx-secondary flex items-center justify-center transition-colors"
          >
            {isMuted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-12 h-1 bg-app-border rounded-lg appearance-none cursor-pointer accent-accent-primary max-sm:hidden"
          />
        </div>

        {/* 倍速播放 */}
        <button
          onClick={cycleSpeed}
          className="px-2 py-0.5 rounded bg-app-hover hover:bg-app-active text-[10px] font-semibold text-tx-secondary transition-all shrink-0 z-10"
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 辅助：评论与点赞处理
// ============================================================
interface ProcessedComment extends DiaryComment {
  replies: ProcessedComment[];
  replyToUsername?: string;
  parentCommentId?: string;
}

function processComments(comments: DiaryComment[]): ProcessedComment[] {
  const sorted = [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const rootComments: ProcessedComment[] = [];
  const commentToRootMap = new Map<string, ProcessedComment>();
  const userLatestCommentMap = new Map<string, ProcessedComment>();

  for (const c of sorted) {
    const processed: ProcessedComment = { ...c, replies: [] };
    const match = c.content.match(/^@([^\s:]+)(?:\s+|:)(.*)$/);
    let rootComment: ProcessedComment | undefined;
    let replyToUser: string | undefined;

    if (match) {
      const targetUsername = match[1];
      const remainingContent = match[2];
      
      const targetComment = userLatestCommentMap.get(targetUsername);
      if (targetComment) {
        replyToUser = targetUsername;
        processed.content = remainingContent;
        rootComment = commentToRootMap.get(targetComment.id) || targetComment;
      }
    }

    if (rootComment) {
      processed.replyToUsername = replyToUser;
      processed.parentCommentId = rootComment.id;
      rootComment.replies.push(processed);
      commentToRootMap.set(processed.id, rootComment);
    } else {
      rootComments.push(processed);
      commentToRootMap.set(processed.id, processed);
    }

    userLatestCommentMap.set(c.username, processed);
  }

  return rootComments.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function getStableLikeCount(diaryId: string, isLiked: boolean): number {
  return isLiked ? 1 : 0;
}

// ============================================================
// 单条说说卡片
// ============================================================
function DiaryCard({
  item,
  onDelete,
  onUpdate,
  isHighlighted,
  search,
  onTagClick,
}: {
  item: Diary;
  onDelete: (id: string) => void;
  onUpdate: (updated: Diary) => void;
  isHighlighted?: boolean;
  search?: string;
  onTagClick?: (tagId: string) => void;
}) {
  const { t } = useTranslation();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<DiaryComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentCursorPos, setCommentCursorPos] = useState(0);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [showCommentEmojis, setShowCommentEmojis] = useState(false);
  const commentEmojiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (commentEmojiRef.current && !commentEmojiRef.current.contains(e.target as Node)) {
        setShowCommentEmojis(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (commentInputRef.current) {
      commentInputRef.current.style.height = "auto";
      commentInputRef.current.style.height = `${commentInputRef.current.scrollHeight}px`;
    }
  }, [newCommentText]);
  const commentMentionTrigger = useMentionState(newCommentText, commentCursorPos);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const mountRef = useRef(true);
  useEffect(() => { return () => { mountRef.current = false; }; }, []);

  useEffect(() => {
    if (!showActionMenu) return;
    const handleGlobalClick = () => {
      setShowActionMenu(false);
    };
    document.addEventListener("click", handleGlobalClick);
    return () => {
      document.removeEventListener("click", handleGlobalClick);
    };
  }, [showActionMenu]);

  useEffect(() => {
    const fetchMe = () => {
      api.getMe().then((meData) => {
        if (meData) setCurrentUser(meData);
      }).catch(console.error);
    };
    fetchMe();
    window.addEventListener("super:profile-updated", fetchMe);
    return () => window.removeEventListener("super:profile-updated", fetchMe);
  }, []);

  useEffect(() => {
    if (!showComments) return;
    setLoadingComments(true);
    api.getDiaryComments(item.id)
      .then((commentsData) => {
        setComments(commentsData);
      })
      .catch((err) => {
        console.error("Failed to load comments:", err);
        toast.error("加载评论失败");
      })
      .finally(() => setLoadingComments(false));
  }, [showComments, item.id]);

  useEffect(() => {
    const handleAiComment = (e: Event) => {
      const customEvent = e as CustomEvent<{ diaryId: string }>;
      if (customEvent.detail.diaryId === item.id) {
        if (showComments) {
          setLoadingComments(true);
          api.getDiaryComments(item.id)
            .then((commentsData) => {
              setComments(commentsData);
              onUpdate({ ...item, commentCount: commentsData.length });
            })
            .catch(console.error)
            .finally(() => setLoadingComments(false));
        } else {
          onUpdate({ ...item, commentCount: (item.commentCount || 0) + 1 });
        }
      }
    };
    window.addEventListener("super:diary-ai-comment", handleAiComment);
    return () => window.removeEventListener("super:diary-ai-comment", handleAiComment);
  }, [item.id, item, showComments, onUpdate]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || submittingComment) return;

    // === AI @su 检测 ===
    const su = detectSuMention(newCommentText.trim());
    if (su.hasSu) {
      const currentText = newCommentText;
      setNewCommentText("");
      toast.success("AI 助手正在处理，请稍后查看");
      haptic.light();
      
      api.diaryAiAsk({ mode: "comment", diaryId: item.id, question: su.cleanText })
        .then((result: any) => {
          if (result && result.taskId) {
            subscribeToAiTaskSSE(result.taskId, (resData) => {
              if (mountRef.current && resData.mode === "comment") {
                setComments((prev) => [...prev, resData.comment]);
                onUpdate({ ...item, commentCount: (item.commentCount || 0) + 1 });
                toast.success("AI 助手已回复");
              }
            });
          }
        })
        .catch((err) => {
          console.error("AI comment failed:", err);
          toast.error(err?.message || "AI 助手请求失败");
          if (mountRef.current) {
            setNewCommentText(currentText);
          }
        });
      return;
    }
    // === 普通评论逻辑 ===
    setSubmittingComment(true);
    try {
      const newComment = await api.postDiaryComment(item.id, newCommentText.trim());
      setComments((prev) => [...prev, newComment]);
      setNewCommentText("");
      onUpdate({ ...item, commentCount: (item.commentCount || 0) + 1 });
      toast.success("发表评论成功");
    } catch (err: any) {
      console.error("Failed to add comment:", err);
      toast.error(err?.message || "发表评论失败");
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    const ok = await confirmDialog({
      title: "删除评论",
      description: "确定要删除该评论吗？此操作不可撤销。",
      confirmText: "删除",
      cancelText: "取消"
    });
    if (!ok) return;
    try {
      await api.deleteDiaryComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      onUpdate({ ...item, commentCount: Math.max(0, (item.commentCount || 1) - 1) });
      toast.success("评论已删除");
    } catch (err: any) {
      console.error("Failed to delete comment:", err);
      toast.error(err?.message || "删除评论失败");
    }
  };
  const [isLiked, setIsLiked] = useState(() => {
    try {
      const likedIds = JSON.parse(localStorage.getItem("super-liked-diaries") || "[]");
      return likedIds.includes(item.id);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleLikeChange = () => {
      try {
        const likedIds = JSON.parse(localStorage.getItem("super-liked-diaries") || "[]");
        setIsLiked(likedIds.includes(item.id));
      } catch {}
    };
    window.addEventListener("super:diary-like-changed", handleLikeChange);
    return () => window.removeEventListener("super:diary-like-changed", handleLikeChange);
  }, [item.id]);

  const handleToggleLike = () => {
    try {
      const likedIds = JSON.parse(localStorage.getItem("super-liked-diaries") || "[]");
      const exists = likedIds.includes(item.id);
      let newLikedIds;
      if (exists) {
        newLikedIds = likedIds.filter((id: string) => id !== item.id);
      } else {
        newLikedIds = [...likedIds, item.id];
      }
      localStorage.setItem("super-liked-diaries", JSON.stringify(newLikedIds));
      window.dispatchEvent(new CustomEvent("super:diary-like-changed"));
      haptic.light();
    } catch (e) {
      console.error(e);
    }
  };

  const moodEmoji = getMoodEmoji(item.mood);
  // 工作区下展示发布者；个人空间下省略（一定是自己）。
  const showCreator =
    !!item.creatorName && getCurrentWorkspace() !== "personal";

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: "删除说说",
      description: "确定要删除这条说说吗？此操作不可撤销。",
      confirmText: "删除",
      cancelText: "取消"
    });
    if (ok) {
      onDelete(item.id);
    }
  };

  // 编辑模式直接渲染编辑器，整张卡被替换；保存/取消会回到只读视图
  if (isEditing) {
    return (
      <DiaryEditor
        item={item}
        onCancel={() => setIsEditing(false)}
        onSaved={(updated) => {
          onUpdate(updated);
          setIsEditing(false);
        }}
      />
    );
  }
  let coverUrl = "";
  if (item.bookMetadata) {
    try {
      const meta = JSON.parse(item.bookMetadata);
      if (meta.coverAttachmentId) {
        coverUrl = `${getServerUrl()}/api/attachments/${meta.coverAttachmentId}`;
      }
    } catch {}
  }

  const handleOpenBook = () => {
    if (item.bookHash) {
      if (item.bookNoteId) {
        localStorage.setItem("super-target-book-note-id", item.bookNoteId);
      }
      localStorage.setItem("super-target-book-hash", item.bookHash);
      window.dispatchEvent(new CustomEvent("super:open-book", {
        detail: { bookHash: item.bookHash }
      }));
    }
  };

  return (
    <>
      <motion.div
        id={`diary-card-${item.id}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="group scroll-mt-20"
      >
        <div className={cn(
          "bg-app-surface border border-app-border/40 shadow-sm rounded-xl transition-all duration-300 hover:shadow-md",
          isHighlighted ? "ring-2 ring-accent-primary border-accent-primary shadow-lg shadow-accent-primary/20 scale-[1.01]" : ""
        )}>
          <div className="p-4">
            {/* 顶部头部区域：头像、作者、时间、可见性 */}
            <div className="flex items-start justify-between mb-3.5 select-none">
              <div className="flex items-center gap-2.5">
                {/* 头像 */}
                {item.userId === SU_USER_ID ? (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-base shrink-0 shadow-sm">
                    🤖
                  </div>
                ) : item.creatorAvatarUrl ? (
                  <img
                    src={item.creatorAvatarUrl}
                    alt={item.creatorName || "avatar"}
                    className="w-9 h-9 rounded-full object-cover shrink-0 border border-app-border/45 shadow-sm"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-accent-primary/10 text-accent-primary flex items-center justify-center font-bold text-xs shrink-0 border border-app-border/45 shadow-sm">
                    {(item.creatorName || (currentUser && item.userId === currentUser.id ? currentUser.username : "User")).slice(0, 1).toUpperCase()}
                  </div>
                )}

                {/* 作者与时间 */}
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-tx-primary leading-tight">
                    {item.creatorName || (currentUser && item.userId === currentUser.id ? currentUser.username : "匿名用户")}
                  </span>
                  <span className="text-[10px] text-tx-tertiary mt-0.5 leading-none flex items-center gap-1.5">
                    <span>{timeAgo(item.createdAt, t)}</span>
                    {moodEmoji && <span>{moodEmoji}</span>}
                  </span>
                </div>
              </div>

              {/* 右侧：可见性状态 */}
              {getCurrentWorkspace() !== "personal" && (
                <div className="flex items-center gap-1 text-[10px] text-tx-tertiary">
                  {item.visibility === "PUBLIC" ? (
                    <>
                      <Globe size={11} className="opacity-60" />
                      <span>公开</span>
                    </>
                  ) : (
                    <>
                      <Lock size={11} className="opacity-60" />
                      <span>仅自己可见</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 内容（支持 HTML & Markdown 渲染） */}
            {item.contentText && (
              <div
                className="diary-rendered-content prose prose-sm dark:prose-invert max-w-none text-sm text-tx-primary leading-relaxed break-words"
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  const placeholder = target.closest(".iframe-placeholder-wrapper") as HTMLDivElement | null;
                  if (placeholder) {
                    e.preventDefault();
                    e.stopPropagation();
                    const src = placeholder.getAttribute("data-src") || "";
                    const iframe = document.createElement("iframe");
                    iframe.src = src;
                    iframe.style.width = "100%";
                    iframe.style.height = "100%";
                    iframe.style.border = "none";
                    iframe.setAttribute("allowfullscreen", "true");
                    try {
                      const attrsStr = placeholder.getAttribute("data-attrs") || "{}";
                      const attrs = JSON.parse(attrsStr);
                      Object.keys(attrs).forEach((key) => {
                        if (key !== "src" && key !== "style") {
                          iframe.setAttribute(key, attrs[key]);
                        }
                      });
                    } catch (err) {
                      console.error(err);
                    }
                    placeholder.innerHTML = "";
                    placeholder.appendChild(iframe);
                    placeholder.style.cursor = "default";
                  }
                }}
                dangerouslySetInnerHTML={{ __html: highlightHtmlKeyword(renderDiaryContent(item.contentText), search) }}
              />
            )}

            {/* Book & Highlight Card Share wrapper */}
            {item.bookHash && (
              <div className="mt-3 space-y-2 border border-app-border/30 rounded-xl p-3 bg-black/5 dark:bg-white/5">
                {/* Note highlight text quoted if present */}
                {item.bookNoteText && (
                  <p className="text-xs italic font-serif opacity-90 border-l-2 border-accent-primary pl-2.5 leading-relaxed text-tx-secondary whitespace-pre-wrap">
                    "{item.bookNoteText}"
                  </p>
                )}
                
                {/* Book Card wrapper */}
                <div 
                  onClick={handleOpenBook}
                  className="flex items-center gap-3 bg-app-surface border border-app-border/50 rounded-lg p-2.5 hover:border-accent-primary hover:bg-app-hover/50 cursor-pointer transition-all active:scale-[0.98] select-none"
                  title="点击开始阅读此书"
                >
                  {/* Cover */}
                  <div className="w-10 h-14 rounded bg-black/10 dark:bg-white/10 flex items-center justify-center overflow-hidden shrink-0 shadow-sm border border-app-border/30">
                    {coverUrl ? (
                      <img src={coverUrl} alt={item.bookTitle || "Book Cover"} className="w-full h-full object-cover" />
                    ) : (
                      <BookOpen size={16} className="text-tx-tertiary opacity-70" />
                    )}
                  </div>
                  {/* Metadata */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-tx-primary truncate leading-tight">
                      {item.bookTitle || "共享图书"}
                    </h4>
                    <p className="text-[10px] text-tx-tertiary truncate mt-1">
                      {item.bookAuthor || "未知作者"}
                    </p>
                  </div>
                  {/* Right Action Icon Indicator */}
                  <div className="text-[9px] font-semibold text-accent-primary px-2 py-1 bg-accent-primary/10 rounded-md shrink-0">
                    去阅读
                  </div>
                </div>
              </div>
            )}

            {/* 语音播放器 */}
            {item.voice && (
              <VoicePlayer item={item} onUpdate={onUpdate} />
            )}

            {/* 图片网格 */}
            {item.images && item.images.length > 0 && (
              <ImageGrid ids={item.images} attachments={item.attachments} onOpen={setLightboxIdx} />
            )}

            {/* 标签列表 */}
            {item.tags && item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {item.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border cursor-pointer hover:bg-app-hover active:scale-95 transition-all select-none"
                    style={{
                      backgroundColor: getTagColor(tag) + "15",
                      borderColor: getTagColor(tag) + "30",
                      color: getTagColor(tag),
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTagClick?.(tag.id);
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}

            {/* 分割线 */}
            <div className="border-t border-app-border/40 my-3" />

            {/* 底部操作区 */}
            <div className="flex items-center justify-between text-xs text-tx-tertiary select-none">
              <div className="flex items-center gap-4">
                {/* 点赞按钮 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleLike();
                  }}
                  className={cn(
                    "flex items-center gap-1 hover:text-rose-500 transition-colors font-medium py-1",
                    isLiked && "text-rose-500 hover:text-rose-600"
                  )}
                >
                  <Heart size={14} className={cn(isLiked && "fill-rose-500")} />
                  <span>赞</span>
                  {getStableLikeCount(item.id, isLiked) > 0 && (
                    <span className="tabular-nums">({getStableLikeCount(item.id, isLiked)})</span>
                  )}
                </button>

                {/* 评论按钮 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowComments(!showComments);
                  }}
                  className="flex items-center gap-1 hover:text-accent-primary transition-colors font-medium py-1"
                >
                  <MessageCircle size={14} />
                  <span>评论</span>
                  {item.commentCount && item.commentCount > 0 && (
                    <span className="tabular-nums">({item.commentCount})</span>
                  )}
                </button>
              </div>

              {/* 右侧：••• 操作菜单 */}
              <div className="relative flex items-center">
                {item.triggerUserId && item.userId === SU_USER_ID && (
                  <span className="text-[10px] text-tx-tertiary mr-2 opacity-80">
                    AI 助手生成
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowActionMenu(!showActionMenu);
                  }}
                  className="p-1.5 rounded-md text-tx-tertiary hover:bg-app-hover hover:text-tx-secondary active:scale-95 transition-all"
                  title="操作菜单"
                >
                  <MoreHorizontal size={16} />
                </button>

                <AnimatePresence>
                  {showActionMenu && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, x: 10 }}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95, x: 10 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="absolute right-full mr-2 top-1/2 -translate-y-[calc(50%+2px)] bg-[#2c2c2c] text-[#f5f5f5] rounded-lg shadow-xl px-1.5 py-1 z-50 flex flex-row items-center divide-x divide-[#3a3a3a] max-w-[calc(100vw-5rem)] overflow-x-auto hide-scrollbar"
                    >
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setShowActionMenu(false);
                          try {
                            const updated = await api.updateDiary(item.id, { isPinned: item.isPinned ? 0 : 1 });
                            onUpdate(updated);
                            toast.success(item.isPinned ? "已取消置顶" : "已置顶");
                          } catch (err) {
                            toast.error("操作失败");
                          }
                        }}
                        className="px-2.5 py-1 text-[11px] font-medium flex items-center gap-1 hover:bg-white/10 active:bg-white/15 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Pin size={12} className={cn(item.isPinned && "fill-white")} />
                        <span>{item.isPinned ? "取消置顶" : "置顶"}</span>
                      </button>

                      {currentUser && item.userId === currentUser.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowActionMenu(false);
                            setIsEditing(true);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium flex items-center gap-1 hover:bg-white/10 active:bg-white/15 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Edit2 size={12} />
                          <span>{t("diary.edit")}</span>
                        </button>
                      )}

                      {currentUser && (item.userId === currentUser.id || item.triggerUserId === currentUser.id) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowActionMenu(false);
                            void handleDelete();
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium flex items-center gap-1 text-red-400 hover:bg-white/10 active:bg-red-500/10 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Trash2 size={12} />
                          <span>{t("diary.delete")}</span>
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* 评论展开区 */}
            {showComments && (
              <div className="mt-4 pt-3 border-t border-app-border/30 space-y-3">
                {/* 评论列表 */}
                {loadingComments ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-4 h-4 text-accent-primary animate-spin" />
                  </div>
                ) : comments.length === 0 ? (
                  <div className="text-center text-xs text-tx-tertiary py-2">暂无评论</div>
                ) : (
                  <div className="space-y-4">
                    {processComments(comments).map((comment) => (
                      <div key={comment.id} className="space-y-2">
                        {/* Root Comment */}
                        <div className="flex items-start gap-2.5 text-xs">
                          {/* Avatar */}
                          {comment.userId === SU_USER_ID ? (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-xs mt-0.5 shrink-0 z-10">
                              🤖
                            </div>
                          ) : comment.avatarUrl ? (
                            <img
                              src={comment.avatarUrl}
                              alt={comment.username}
                              className="w-7 h-7 rounded-full object-cover mt-0.5 shrink-0 z-10"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-accent-primary/10 text-accent-primary flex items-center justify-center font-bold text-xs mt-0.5 shrink-0 z-10">
                              {comment.username.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          
                          {/* Content */}
                          <div className="flex-1 min-w-0 bg-app-subtle/50 px-3 py-2 rounded-xl">
                            <div className="flex items-center justify-between">
                              <span className={cn("font-semibold", comment.userId === SU_USER_ID ? "text-violet-500" : "text-tx-primary")}>
                                {comment.userId === SU_USER_ID ? "AI 助手" : comment.username}
                              </span>
                              <span className="text-[10px] text-tx-tertiary">{timeAgo(comment.createdAt, t)}</span>
                            </div>
                            <p className="diary-comment-text text-tx-secondary mt-1 whitespace-pre-wrap break-words">{renderTextWithLinks(comment.content)}</p>
                            
                            {/* Action Buttons */}
                            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-tx-tertiary">
                              <button
                                type="button"
                                onClick={() => {
                                  setNewCommentText(`@${comment.username} `);
                                  commentInputRef.current?.focus();
                                }}
                                className="hover:text-accent-primary transition-colors font-medium"
                              >
                                回复
                              </button>
                              
                              {(comment.userId === currentUser?.id || item.userId === currentUser?.id || comment.trigger_user_id === currentUser?.id) && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(comment.id)}
                                  className="hover:text-red-500 transition-colors font-medium"
                                >
                                  删除
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Nested Replies */}
                        {comment.replies.length > 0 && (
                          <div className="ml-9 p-2 rounded-xl bg-app-subtle/20 border border-app-border/20 space-y-1">
                            {comment.replies.map((reply, replyIdx) => {
                              const isLastReply = replyIdx === comment.replies.length - 1;
                              return (
                                <div key={reply.id} className="relative flex items-start gap-2 text-xs pl-6 py-1.5">
                                  {/* Connector Line */}
                                  <div className={cn(
                                    "absolute left-[11px] w-px bg-app-border/40",
                                    isLastReply ? "top-0 h-[18px]" : "top-0 bottom-0"
                                  )} />
                                  <div className="absolute left-[11px] top-[18px] w-3 h-px bg-app-border/40" />

                                  {/* Avatar */}
                                  {reply.userId === SU_USER_ID ? (
                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-[10px] shrink-0 z-10">
                                      🤖
                                    </div>
                                  ) : reply.avatarUrl ? (
                                    <img
                                      src={reply.avatarUrl}
                                      alt={reply.username}
                                      className="w-5 h-5 rounded-full object-cover shrink-0 z-10"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-accent-primary/10 text-accent-primary flex items-center justify-center font-bold text-[9px] shrink-0 z-10">
                                      {reply.username.slice(0, 1).toUpperCase()}
                                    </div>
                                  )}

                                  {/* Reply content */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={cn("font-semibold", reply.userId === SU_USER_ID ? "text-violet-500" : "text-tx-primary")}>
                                        {reply.userId === SU_USER_ID ? "AI 助手" : reply.username}
                                      </span>
                                      {reply.replyToUsername && (
                                        <>
                                          <span className="text-tx-tertiary text-[10px]">回复</span>
                                          <span className="font-semibold text-tx-primary">
                                            {reply.replyToUsername === "AI 助手" || reply.replyToUsername === "su" ? "AI 助手" : reply.replyToUsername}
                                          </span>
                                        </>
                                      )}
                                      <span className="text-[10px] text-tx-tertiary ml-auto shrink-0">{timeAgo(reply.createdAt, t)}</span>
                                    </div>
                                    <p className="diary-comment-text text-tx-secondary mt-1 whitespace-pre-wrap break-words">{renderTextWithLinks(reply.content)}</p>
                                    
                                    {/* Actions */}
                                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-tx-tertiary">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setNewCommentText(`@${reply.username} `);
                                          commentInputRef.current?.focus();
                                        }}
                                        className="hover:text-accent-primary transition-colors font-medium"
                                      >
                                        回复
                                      </button>
                                      
                                      {(reply.userId === currentUser?.id || item.userId === currentUser?.id || reply.trigger_user_id === currentUser?.id) && (
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteComment(reply.id)}
                                          className="hover:text-red-500 transition-colors font-medium"
                                        >
                                          删除
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const url = window.prompt("输入链接地址 (URL)", "https://");
                                          if (!url) return;
                                          const linkText = window.prompt("输入链接文字", "链接");
                                          if (!linkText) return;
                                          const formatted = `[${linkText}](${url})`;
                                          const before = newCommentText.substring(0, commentCursorPos);
                                          const after = newCommentText.substring(commentCursorPos);
                                          setNewCommentText(before + formatted + after);
                                        }}
                                        className="text-tx-tertiary hover:text-tx-secondary transition-colors ml-1.5"
                                        title="插入超链接"
                                      >
                                        <Link size={16} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                {/* 发表评论输入框 */}
                <form onSubmit={handleAddComment} className="flex gap-2.5 items-center pt-2 w-full">
                  {currentUser && (
                    currentUser.avatarUrl ? (
                      <img
                        src={currentUser.avatarUrl}
                        alt={currentUser.username}
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-accent-primary/10 text-accent-primary flex items-center justify-center font-bold text-xs shrink-0">
                        {currentUser.username.slice(0, 1).toUpperCase()}
                      </div>
                    )
                  )}

                  <div className="relative flex-1 min-w-0 bg-app-subtle border border-app-border/60 rounded-[18px] px-3.5 py-1.5 flex items-end gap-2 focus-within:border-accent-primary transition-all">
                    <textarea
                      ref={commentInputRef}
                      rows={1}
                      placeholder="写下你的评论..."
                      value={newCommentText}
                      onChange={(e) => {
                        setNewCommentText(e.target.value);
                        setCommentCursorPos(e.target.selectionStart || 0);
                      }}
                      onSelect={(e) => setCommentCursorPos((e.target as HTMLTextAreaElement).selectionStart || 0)}
                      onClick={(e) => setCommentCursorPos((e.target as HTMLTextAreaElement).selectionStart || 0)}
                      onKeyUp={(e) => setCommentCursorPos((e.target as HTMLTextAreaElement).selectionStart || 0)}
                      onKeyDown={(e) => {
                        if (commentMentionTrigger) {
                          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
                            e.preventDefault();
                            return;
                          }
                        }

                        if (e.key === "Enter") {
                          if (e.shiftKey) {
                            // Let default newline happen
                          } else {
                            // Send comment
                            e.preventDefault();
                            void handleAddComment(e as any);
                          }
                        }
                      }}
                      className="flex-1 min-w-0 w-full bg-transparent border-none text-xs text-tx-primary focus:outline-none focus:ring-0 placeholder:text-tx-tertiary p-0 resize-none max-h-32 min-h-[18px] overflow-y-auto"
                      style={{ height: "auto" }}
                    />

                     {/* Smile Icon with Emoji Picker */}
                    <div ref={commentEmojiRef} className="relative flex items-center shrink-0 mb-0.5">
                      <button
                        type="button"
                        onClick={() => setShowCommentEmojis(!showCommentEmojis)}
                        className="text-tx-tertiary hover:text-tx-secondary transition-colors"
                        title="选择表情"
                      >
                        <Smile size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const url = window.prompt("输入链接地址 (URL)", "https://");
                          if (!url) return;
                          const linkText = window.prompt("输入链接文字", "链接");
                          if (!linkText) return;
                          const formatted = `[${linkText}](${url})`;
                          const before = newCommentText.substring(0, commentCursorPos);
                          const after = newCommentText.substring(commentCursorPos);
                          setNewCommentText(before + formatted + after);
                        }}
                        className="text-tx-tertiary hover:text-tx-secondary transition-colors ml-1.5"
                        title="插入超链接"
                      >
                        <Link size={16} />
                      </button>

                      <AnimatePresence>
                        {showCommentEmojis && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 10 }}
                            className="absolute bottom-full right-0 mb-2 p-2 bg-app-elevated border border-app-border shadow-lg rounded-xl z-50"
                          >
                            <EmojiPicker
                              onSelectTextEmoji={(emoji) => {
                                const text = newCommentText;
                                const before = text.substring(0, commentCursorPos);
                                const after = text.substring(commentCursorPos);
                                const updated = before + emoji + after;
                                setNewCommentText(updated);
                                const newPos = commentCursorPos + emoji.length;
                                setCommentCursorPos(newPos);
                                setShowCommentEmojis(false);

                                setTimeout(() => {
                                  if (commentInputRef.current) {
                                    commentInputRef.current.focus();
                                    commentInputRef.current.setSelectionRange(newPos, newPos);
                                  }
                                }, 0);
                              }}
                              onSelectImageEmoji={(url) => {
                                const markdownImg = `![emoji](${url})`;
                                const text = newCommentText;
                                const before = text.substring(0, commentCursorPos);
                                const after = text.substring(commentCursorPos);
                                const updated = before + markdownImg + after;
                                setNewCommentText(updated);
                                const newPos = commentCursorPos + markdownImg.length;
                                setCommentCursorPos(newPos);
                                setShowCommentEmojis(false);

                                setTimeout(() => {
                                  if (commentInputRef.current) {
                                    commentInputRef.current.focus();
                                    commentInputRef.current.setSelectionRange(newPos, newPos);
                                  }
                                }, 0);
                              }}
                              className="w-72"
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* @提及选择器 */}
                    {commentMentionTrigger && (
                      <div className="absolute left-0 bottom-full mb-1 z-50">
                        <MentionPicker
                          search={commentMentionTrigger.search}
                          onSelect={(user) => {
                            const newText = replaceMentionText(newCommentText, commentCursorPos, commentMentionTrigger.startIndex, user.username);
                            setNewCommentText(newText);
                            setCommentCursorPos(commentMentionTrigger.startIndex + user.username.length + 2);
                            commentMentionTrigger.clear();
                            commentInputRef.current?.focus();
                          }}
                          onClose={commentMentionTrigger.clear}
                        />
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!newCommentText.trim() || submittingComment}
                    className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-app-hover text-white disabled:text-tx-tertiary/50 disabled:opacity-50 rounded-full text-xs font-semibold transition-all flex items-center gap-1 shrink-0 active:scale-95"
                  >
                    {submittingComment ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    <span>发送</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {lightboxIdx !== null && (
          <Lightbox
            ids={item.images}
            attachments={item.attachments}
            index={lightboxIdx}
            onClose={() => setLightboxIdx(null)}
            onIndexChange={setLightboxIdx}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ============================================================
// 单条说说编辑器（就地编辑模式）
// ============================================================
function DiaryEditor({
  item,
  onCancel,
  onSaved,
}: {
  item: Diary;
  onCancel: () => void;
  onSaved: (updated: Diary) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(item.contentText || "");
  const [mood, setMood] = useState(item.mood || "");
  const [showMoods, setShowMoods] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visibility, setVisibility] = useState<string>(item.visibility || "PRIVATE");
  const [editorTags, setEditorTags] = useState<Tag[]>(item.tags || []);
  const [images, setImages] = useState<PendingImage[]>(() =>
    (item.images || []).map((id) => ({
      localKey: id,
      id,
      previewUrl: api.diaryImages.urlFor(id),
      status: "ready" as const,
    })),
  );
  const imagesRef = useRef<PendingImage[]>([]);
  imagesRef.current = images;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const moodRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 300) + "px";
    }
  }, []);
  useEffect(() => {
    autoResize();
  }, [autoResize]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moodRef.current && !moodRef.current.contains(e.target as Node)) {
        setShowMoods(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    return () => {
      for (const img of imagesRef.current) {
        if (img.previewUrl.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(img.previewUrl);
          } catch {
            /* ignore */
          }
        }
      }
    };
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const current = imagesRef.current;
      const remaining = MAX_IMAGES_PER_DIARY - current.length;
      if (remaining <= 0) return;

      const accepted: File[] = [];
      const rejected: { name: string; reason: string }[] = [];
      for (const f of files) {
        if (accepted.length >= remaining) break;
        const mime = (f.type || "").toLowerCase();
        if (!ALLOWED_IMAGE_MIMES.has(mime)) {
          rejected.push({ name: f.name || "image", reason: "type" });
          continue;
        }
        if (f.size > MAX_DIARY_IMAGE_SIZE) {
          rejected.push({ name: f.name || "image", reason: "size" });
          continue;
        }
        accepted.push(f);
      }
      if (rejected.length) {
        for (const r of rejected) {
          toast.error(
            r.reason === "size"
              ? t("diary.imageTooLarge").replace("{{name}}", r.name)
              : t("diary.imageTypeUnsupported").replace("{{name}}", r.name),
          );
        }
      }
      if (!accepted.length) return;

      const newItems: PendingImage[] = accepted.map((f) => ({
        localKey: crypto.randomUUID(),
        id: null,
        previewUrl: URL.createObjectURL(f),
        status: "uploading",
      }));
      setImages((prev) => [...prev, ...newItems]);

      newItems.forEach((it, idx) => {
        const file = accepted[idx];
        api.diaryImages
          .upload(file)
          .then((res) => {
            setImages((prev) =>
              prev.map((p) =>
                p.localKey === it.localKey
                  ? { ...p, id: res.id, status: "ready" as const }
                  : p,
              ),
            );
          })
          .catch((err) => {
            console.error("Diary image upload failed:", err);
            setImages((prev) =>
              prev.map((p) =>
                p.localKey === it.localKey
                  ? {
                      ...p,
                      status: "error" as const,
                      errorMessage: err?.message || "upload failed",
                    }
                  : p,
              ),
            );
          });
      });
    },
    [t],
  );

  const removeImage = useCallback((localKey: string) => {
    const target = imagesRef.current.find((p) => p.localKey === localKey);
    if (!target) return;
    setImages((prev) => prev.filter((p) => p.localKey !== localKey));
    if (target.previewUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(target.previewUrl);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    void addFiles(files);
    e.target.value = "";
  };

  const hasPendingUploads = images.some((p) => p.status === "uploading");
  const hasErrorImages = images.some((p) => p.status === "error");
  const readyImageIds = images
    .filter((p) => p.status === "ready" && p.id)
    .map((p) => p.id!) as string[];

  const canSave =
    !saving &&
    !hasPendingUploads &&
    (text.trim().length > 0 || readyImageIds.length > 0);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const updated = await api.updateDiary(item.id, {
        contentText: text.trim(),
        mood,
        images: readyImageIds,
        visibility,
        tagIds: editorTags.map((t) => t.id),
      });
      onSaved(updated);
    } catch (e: unknown) {
      console.error("Save diary failed:", e);
      toast.error(e instanceof Error ? e.message : t("diary.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const selectedMoodEmoji = getMoodEmoji(mood);
  const remainingSlots = MAX_IMAGES_PER_DIARY - images.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="bg-app-surface/60 backdrop-blur-sm rounded-lg border border-accent-primary/40 ring-1 ring-accent-primary/20 shadow-sm"
    >
      <div className="p-4 pb-2">
        <div className="flex items-center gap-1.5 mb-2 text-[11px] text-accent-primary">
          <Edit2 size={11} />
          <span>{t("diary.editing")}</span>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("diary.editPlaceholder")}
          rows={4}
          className="w-full bg-transparent text-tx-primary placeholder:text-tx-tertiary text-sm leading-relaxed resize-none outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 border-none min-h-[100px] no-focus-ring"
          autoFocus
        />

        {/* 标签选择（支持创建新标签） */}
        <div className="mt-2">
          <GenericTagInput
            selectedTags={editorTags}
            onTagsChange={setEditorTags}
            placeholder="添加或创建标签..."
          />
        </div>

        {/* 图片缩略图 */}
        {images.length > 0 && (
          <div className="mt-2 grid grid-cols-4 sm:grid-cols-5 gap-2">
            {images.map((img) => (
              <div
                key={img.localKey}
                className="relative aspect-square rounded-lg overflow-hidden border border-app-border bg-app-hover/40 group/img"
              >
                <img
                  src={img.previewUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                {img.status === "uploading" && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Loader2 size={18} className="animate-spin text-white" />
                  </div>
                )}
                {img.status === "error" && (
                  <div
                    className="absolute inset-0 bg-red-500/60 flex items-center justify-center text-[10px] text-white text-center px-1"
                    title={img.errorMessage}
                  >
                    {t("diary.uploadFailed")}
                  </div>
                )}
                <button
                  onClick={() => removeImage(img.localKey)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                  aria-label={t("diary.removeImage")}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between px-4 pb-3">
        <div className="flex items-center gap-1">
          {/* 心情按钮 */}
          <div ref={moodRef} className="relative">
            <button
              onClick={() => setShowMoods(!showMoods)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs transition-all",
                mood
                  ? "bg-accent-primary/10 text-accent-primary"
                  : "text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover",
              )}
            >
              {selectedMoodEmoji ? (
                <span className="text-base">{selectedMoodEmoji}</span>
              ) : (
                <Smile size={18} />
              )}
              <span className="hidden sm:inline">
                {mood ? t(`diary.mood${mood.charAt(0).toUpperCase() + mood.slice(1)}`) : t("diary.mood")}
              </span>
            </button>

            <AnimatePresence>
              {showMoods && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 mt-2 p-2.5 bg-app-elevated rounded-xl border border-app-border shadow-lg z-20 w-[220px]"
                >
                  <div className="grid grid-cols-6 gap-1.5">
                    {MOODS.map(({ value: v, emoji }) => (
                      <button
                        key={v}
                        onClick={() => {
                          setMood(mood === v ? "" : v);
                          setShowMoods(false);
                        }}
                        className={cn(
                          "w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-base transition-all",
                          mood === v
                            ? "bg-accent-primary/15 scale-110 ring-1 ring-accent-primary/30"
                            : "hover:bg-app-hover hover:scale-110",
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 图片按钮 */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={remainingSlots <= 0}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs transition-all",
              remainingSlots <= 0
                ? "text-tx-tertiary/50 cursor-not-allowed"
                : "text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover",
            )}
            title={
              remainingSlots <= 0
                ? t("diary.imageLimitReached").replace(
                    "{{n}}",
                    String(MAX_IMAGES_PER_DIARY),
                  )
                : t("diary.addImage")
            }
          >
            <ImagePlus size={18} />
            <span className="hidden sm:inline">{t("diary.image")}</span>
            {images.length > 0 && (
              <span className="text-[10px] text-tx-tertiary tabular-nums">
                {images.length}/{MAX_IMAGES_PER_DIARY}
              </span>
            )}
          </button>
          
          {/* 超链接按钮 */}
          <button
            type="button"
            onClick={() => {
              const url = window.prompt("输入链接地址 (URL)", "https://");
              if (!url) return;
              const textVal = window.prompt("输入链接文字", "链接");
              if (!textVal) return;
              const formatted = `[${textVal}](${url})`;
              const textarea = textareaRef.current;
              if (textarea) {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const updated = text.substring(0, start) + formatted + text.substring(end);
                setText(updated);
              } else {
                setText(text + formatted);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover transition-all"
            title="插入超链接"
          >
            <Link size={18} />
            <span className="hidden sm:inline">超链接</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* 可见性范围选择 - 个人空间无需选择，始终仅自己可见 */}
          {getCurrentWorkspace() !== "personal" && (
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className="text-[11px] bg-app-hover/80 border border-app-border text-tx-secondary rounded-full px-2.5 py-1 outline-none cursor-pointer focus:border-accent-primary/50 transition-all font-medium"
          >
            <option value="PRIVATE">🔒 自己可见</option>
            <option value="PUBLIC"> 公开</option>
          </select>
          )}
          {/* 字数计数 */}
          <span
            className={cn(
              "text-[11px] tabular-nums transition-colors",
              text.length > 500 ? "text-red-400" : "text-tx-tertiary",
            )}
          >
            {text.length > 0 && text.length}
          </span>

          {/* 保存按钮 */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all",
              canSave
                ? "bg-accent-primary text-white hover:bg-accent-primary/90 shadow-sm shadow-accent-primary/20 active:scale-95"
                : "bg-app-hover text-tx-tertiary cursor-not-allowed",
            )}
            title={
              hasPendingUploads
                ? t("diary.waitingUpload")
                : hasErrorImages
                ? t("diary.errorImagesHint")
                : undefined
            }
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} />
            )}
            <span>{t("diary.save") || "保存"}</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// 时间筛选
// ============================================================
type RangePreset = "all" | "today" | "week" | "month" | "custom";

interface DateRange {
  from?: string; // YYYY-MM-DD or ISO; undefined 表示不限制下界
  to?: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function presetToRange(
  preset: RangePreset,
  customRange?: DateRange,
): DateRange | null {
  const now = new Date();
  switch (preset) {
    case "all":
      return null;
    case "today":
      return { from: ymd(now) };
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { from: ymd(d) };
    }
    case "month": {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { from: ymd(d) };
    }
    case "custom":
      if (!customRange?.from && !customRange?.to) return null;
      return { from: customRange.from, to: customRange.to };
  }
}

function FilterBar({
  preset,
  customRange,
  onChange,
}: {
  preset: RangePreset;
  customRange: DateRange;
  onChange: (preset: RangePreset, customRange: DateRange) => void;
}) {
  const { t } = useTranslation();
  const [showCustom, setShowCustom] = useState(false);
  const [draftFrom, setDraftFrom] = useState(customRange.from || "");
  const [draftTo, setDraftTo] = useState(customRange.to || "");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCustom) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCustom]);

  useEffect(() => {
    setDraftFrom(customRange.from || "");
    setDraftTo(customRange.to || "");
  }, [customRange.from, customRange.to]);

  const presets: { key: RangePreset; label: string }[] = [
    { key: "all", label: t("diary.filterAll") },
    { key: "today", label: t("diary.filterToday") },
    { key: "week", label: t("diary.filterWeek") },
    { key: "month", label: t("diary.filterMonth") },
  ];

  const customLabel = useMemo(() => {
    if (preset !== "custom") return t("diary.filterCustom");
    if (customRange.from && customRange.to) return `${customRange.from} ~ ${customRange.to}`;
    if (customRange.from) return `${customRange.from} ~`;
    if (customRange.to) return `~ ${customRange.to}`;
    return t("diary.filterCustom");
  }, [preset, customRange.from, customRange.to, t]);

  const applyCustom = () => {
    let f = draftFrom || undefined;
    let to = draftTo || undefined;
    if (f && to && f > to) [f, to] = [to, f];
    onChange("custom", { from: f, to });
    setShowCustom(false);
  };
  const clearCustom = () => {
    setDraftFrom("");
    setDraftTo("");
    onChange("all", {});
    setShowCustom(false);
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {presets.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key, customRange)}
          className={cn(
            "px-2.5 py-1 rounded-full text-[11px] font-medium transition-all",
            preset === key
              ? "bg-accent-primary text-white shadow-sm shadow-accent-primary/20"
              : "bg-app-hover/60 text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover",
          )}
        >
          {label}
        </button>
      ))}

      <div ref={popoverRef} className="relative">
        <button
          onClick={() => setShowCustom((v) => !v)}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all",
            preset === "custom"
              ? "bg-accent-primary text-white shadow-sm shadow-accent-primary/20"
              : "bg-app-hover/60 text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover",
          )}
        >
          <Calendar size={11} />
          <span>{customLabel}</span>
        </button>

        <AnimatePresence>
          {showCustom && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 p-3 bg-app-elevated rounded-xl border border-app-border shadow-lg z-30 w-[260px]"
            >
              <div className="space-y-2">
                <div>
                  <label className="block text-[10px] text-tx-tertiary mb-1">
                    {t("diary.filterFrom")}
                  </label>
                  <input
                    type="date"
                    value={draftFrom}
                    max={draftTo || undefined}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs text-tx-primary outline-none no-focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-tx-tertiary mb-1">
                    {t("diary.filterTo")}
                  </label>
                  <input
                    type="date"
                    value={draftTo}
                    min={draftFrom || undefined}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-app-bg border border-app-border text-xs text-tx-primary outline-none no-focus-ring"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 gap-2">
                <button
                  onClick={clearCustom}
                  className="px-2.5 py-1 rounded-lg text-[11px] text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover transition-colors"
                >
                  {t("diary.filterClear")}
                </button>
                <button
                  onClick={applyCustom}
                  disabled={!draftFrom && !draftTo}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[11px] font-medium transition-colors",
                    !draftFrom && !draftTo
                      ? "bg-app-hover text-tx-tertiary cursor-not-allowed"
                      : "bg-accent-primary text-white hover:bg-accent-primary/90",
                  )}
                >
                  {t("diary.filterApply")}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const ScrollContainer = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  ({ children, className }, ref) => {
    if (window.innerWidth < 768) {
      return (
        <div ref={ref} className={cn("overflow-y-auto min-h-0", className)}>
          {children}
        </div>
      );
    }
    return (
      <ScrollArea ref={ref} className={className}>
        {children}
      </ScrollArea>
    );
  }
);
ScrollContainer.displayName = "ScrollContainer";

// ============================================================
// 主组件：DiaryCenter
// ============================================================
export default function DiaryCenter() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  const [items, setItems] = useState<Diary[]>([]);
  const [tagColorPopover, setTagColorPopover] = useState<{
    tagId: string; tagName: string; color: string; x: number; y: number;
  } | null>(null);
  const tagLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tagLongPressFired = useRef(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<DiaryStats | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [filterMode, setFilterMode] = useState<"all" | "public" | "private" | "liked" | string>("all");
  // PR5：说说时间线滚动隐栏
  useScrollHideBars(scrollRef, true, [loading, items.length, filterMode]);

  const [preset, setPreset] = useState<RangePreset>("all");
  const [customRange, setCustomRange] = useState<DateRange>({});
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  // 说说搜索状态 - 从 sessionStorage 恢复
  const [diarySearchQuery, setDiarySearchQuery] = useState(() => {
    try {
      const saved = sessionStorage.getItem("super-diary-search-query");
      return saved ? JSON.parse(saved) : "";
    } catch {
      return "";
    }
  });

  const [showMobileSearch, setShowMobileSearch] = useState(false);

  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [searchMode, setSearchMode] = useState<"AND" | "OR">(() => {
    try {
      const saved = sessionStorage.getItem("super-diary-search-mode");
      return (saved ? JSON.parse(saved) : "AND") as "AND" | "OR";
    } catch {
      return "AND";
    }
  });

  const searchTermsList = useMemo(() => {
    if (!diarySearchQuery || !diarySearchQuery.trim()) return [];
    return diarySearchQuery.trim().split(/\s+/).filter(Boolean);
  }, [diarySearchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(diarySearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [diarySearchQuery]);

  // 处理搜索输入变化
  const handleDiarySearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setDiarySearchQuery(query);
    try {
      sessionStorage.setItem("super-diary-search-query", JSON.stringify(query));
    } catch { /* sessionStorage may be unavailable */ }
  };

  const handleTagClick = useCallback((tagId: string) => {
    const tag = state.tags.find((t) => t.id === tagId);
    if (tag) {
      const tagQuery = `#${tag.name}`;
      setDiarySearchQuery(tagQuery);
      try {
        sessionStorage.setItem("super-diary-search-query", JSON.stringify(tagQuery));
      } catch { /* sessionStorage may be unavailable */ }
      setFilterMode("all");
    }
    const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') || scrollRef.current;
    if (viewport) {
      viewport.scrollTop = 0;
    }
  }, [state.tags]);
  const activeRange = useMemo(
    () => presetToRange(preset, customRange),
    [preset, customRange],
  );

  const activeFilterLabel = useMemo(() => {
    if (filterMode === "all") return null;
    if (filterMode === "public") return { name: "公开", icon: <Globe size={11} className="opacity-70" /> };
    if (filterMode === "private") return { name: "仅自己可见", icon: <Lock size={11} className="opacity-70" /> };
    if (filterMode === "liked") return { name: "我赞过的", icon: <span className="text-[10px]">❤️</span> };
    
    const tag = state.tags.find((t) => t.id === filterMode);
    if (tag) return { name: tag.name, icon: null };
    return null;
  }, [filterMode, state.tags]);

  const loadTimeline = useCallback(
    async (reset = false) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);

      try {
        const cursor = reset ? undefined : nextCursor || undefined;
        let vis = "all";
        let tagId = "all";
        
        if (filterMode === "public") {
          vis = "public";
        } else if (filterMode === "private") {
          vis = "private";
        } else if (filterMode !== "all" && filterMode !== "liked") {
          tagId = filterMode;
        }

        const data = await api.getDiaryTimeline(
          cursor,
          20,
          activeRange || undefined,
          vis,
          tagId === "all" ? undefined : tagId,
          debouncedSearch || undefined,
          searchMode,
        );
        if (reset) {
          setItems(data.items);
        } else {
          setItems((prev) => [...prev, ...data.items]);
        }
        setHasMore(data.hasMore);
        setNextCursor(data.nextCursor);
      } catch (e) {
        console.error("Load timeline failed:", e);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [nextCursor, activeRange, filterMode, debouncedSearch, searchMode],
  );

  const loadStats = useCallback(async () => {
    try {
      const s = await api.getDiaryStats(activeRange || undefined);
      setStats(s);
    } catch {
      /* ignore */
    }
  }, [activeRange]);

  const isFirstRender = useRef(true);
  const [likedVersion, setLikedVersion] = useState(0);

  useEffect(() => {
    const handleLikeChange = () => {
      setLikedVersion((v) => v + 1);
    };
    window.addEventListener("super:diary-like-changed", handleLikeChange);
    return () => window.removeEventListener("super:diary-like-changed", handleLikeChange);
  }, []);

  const displayedItems = useMemo(() => {
    if (filterMode === "liked") {
      try {
        const likedIds = JSON.parse(localStorage.getItem("super-liked-diaries") || "[]");
        return items.filter((item) => likedIds.includes(item.id));
      } catch {
        return [];
      }
    }
    return items;
  }, [items, filterMode, likedVersion]);

  const isFiltering = preset !== "all" || filterMode !== "all" || debouncedSearch !== "";

  // Split items into pinned and unpinned
  const pinnedItems = useMemo(() => displayedItems.filter((item) => item.isPinned === 1), [displayedItems]);
  const unpinnedItems = useMemo(() => displayedItems.filter((item) => item.isPinned !== 1), [displayedItems]);

  const groupedItems = useMemo(() => groupByDate(unpinnedItems, t), [unpinnedItems, t]);

  const handlePost = useCallback(() => {
    setNextCursor(null);
    loadTimeline(true);
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.deleteDiary(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      loadStats();
    } catch (e) {
      console.error("Delete failed:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdate = useCallback((updated: Diary) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  const handleFilterChange = useCallback(
    (next: RangePreset, range: DateRange) => {
      setPreset(next);
      setCustomRange(range);
    },
    [],
  );

  const handleCalendarDateSelect = useCallback((dateStr: string) => {
    setViewMode("list");
    // 设置筛选范围为选中当天
    setPreset("custom");
    setCustomRange({ from: dateStr, to: dateStr });
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setNextCursor(null);
    loadTimeline(true);
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRange, filterMode, debouncedSearch, searchMode]);

  useEffect(() => {
    loadTimeline(true);
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleProfileUpdated = () => {
      loadTimeline(true);
      loadStats();
    };
    window.addEventListener("super:profile-updated", handleProfileUpdated);
    return () => window.removeEventListener("super:profile-updated", handleProfileUpdated);
  }, [loadTimeline, loadStats]);

  useEffect(() => {
    const handleAiReply = (payload: { mode: "post" | "comment"; diaryId: string; answer: string }) => {
      if (payload.mode === "post") {
        setNextCursor(null);
        loadTimeline(true);
        loadStats();
        toast.success("AI 助手已发表说说");
      } else if (payload.mode === "comment") {
        window.dispatchEvent(new CustomEvent("super:diary-ai-comment", { detail: { diaryId: payload.diaryId } }));
        toast.success("AI 助手已发表评论回复");
      }
    };
    realtime.connect();
    const unsub = realtime.on("diary:ai-reply", handleAiReply);
    return () => {
      unsub();
    };
  }, [loadTimeline, loadStats]);

  // 监听的说说快捷跳转事件，自动滚动并高亮目标说说
  useEffect(() => {
    const checkPendingNavigate = () => {
      const pendingRaw = sessionStorage.getItem("super:pending-navigate");
      if (!pendingRaw) return;
      try {
        const pending = JSON.parse(pendingRaw);
        if (pending.sourceType === "diary" && pending.sourceId) {
          const diaryId = pending.sourceId;
          sessionStorage.removeItem("super:pending-navigate");

          // 滚动并高亮
          setTimeout(() => {
            const el = document.getElementById(`diary-card-${diaryId}`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              setHighlightedId(diaryId);
              setTimeout(() => {
                setHighlightedId(null);
              }, 2000);
            }
          }, 150);
        }
      } catch (e) {
        console.error("Error handling diary pending navigate:", e);
      }
    };

    if (items.length > 0) {
      checkPendingNavigate();
    }

    window.addEventListener("super:navigate-to-item-trigger", checkPendingNavigate);
    return () => {
      window.removeEventListener("super:navigate-to-item-trigger", checkPendingNavigate);
    };
  }, [items]);

  // 移动端滚动到底部分页加载说说
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]') || scrollRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      if (window.innerWidth >= 768) return;
      const { scrollHeight, scrollTop, clientHeight } = viewport;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        if (hasMore && !loadingMore && !loading) {
          loadTimeline(false);
        }
      }
    };

    viewport.addEventListener("scroll", handleScroll);
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [hasMore, loadingMore, loading, loadTimeline]);

  useEffect(() => {
    const onWs = () => {
      setNextCursor(null);
      loadTimeline(true);
      loadStats();
    };
    window.addEventListener("super:workspace-changed", onWs);
    return () => window.removeEventListener("super:workspace-changed", onWs);
  }, [loadTimeline, loadStats]);

  return (
    <div className="flex-1 flex h-full md:h-full min-h-0 overflow-hidden bg-app-bg dark:bg-[#121214] justify-center">
      <div className="w-full max-w-5xl flex h-full min-h-0 overflow-hidden">
        {/* 主内容区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {window.innerWidth < 768 && (
          <header
            className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-surface/50 shrink-0 z-40"
            style={{ paddingTop: 'calc(var(--safe-area-top) + 4px)', minHeight: '56px' }}
          >
            {!showMobileSearch ? (
              <>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    onClick={() => actions.setMobileSidebar(true)}
                    className="p-2 -ml-2 rounded-lg text-tx-secondary hover:bg-app-hover active:bg-app-active shrink-0"
                    title="菜单"
                  >
                    <Menu size={20} />
                  </button>
                  <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center shrink-0">
                    <MessageCircle size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-sm font-bold text-tx-primary leading-tight truncate">{t("diary.title") || "说说"}</h1>
                    {stats && (
                      <p className="text-[10px] text-tx-tertiary mt-0.5 leading-none">
                        {t("diary.statsLine")
                          .replace("{{total}}", String(stats.total))
                          .replace("{{today}}", String(stats.todayCount))}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowMobileSearch(true)}
                  className="p-2 rounded-lg text-tx-secondary hover:bg-app-hover active:scale-95"
                >
                  <Search size={18} />
                </button>
              </>
            ) : (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "100%", opacity: 1 }}
                className="flex items-center gap-2 w-full"
              >
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" />
                  <Input
                    autoFocus
                    placeholder="搜索说说..."
                    value={diarySearchQuery}
                    onChange={handleDiarySearchChange}
                    className="pl-8 pr-8 h-8 w-full rounded-full bg-app-hover border-none text-xs no-focus-ring"
                  />
                  {diarySearchQuery && (
                    <button
                      onClick={() => setDiarySearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-tx-tertiary hover:text-tx-secondary"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    setShowMobileSearch(false);
                    setDiarySearchQuery("");
                  }}
                  className="text-xs font-medium text-accent-primary px-2 py-1 active:scale-95"
                >
                  取消
                </button>
              </motion.div>
            )}
          </header>
        )}

        <PullToRefresh onRefresh={async () => { await Promise.all([loadTimeline(true), loadStats()]); }}>
          <ScrollContainer className="flex-1" ref={scrollRef}>
            <div className={cn("max-w-[640px] mx-auto px-4 space-y-6", window.innerWidth < 768 ? "pt-2 pb-6" : "py-6")}>
              {/* 顶部标题 + 统计 (仅在桌面端展示) */}
              {window.innerWidth >= 768 && (
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-accent-primary flex items-center justify-center">
                      <MessageCircle size={18} className="text-white" />
                    </div>
                    <div>
                      <h1 className="text-lg font-bold text-tx-primary leading-tight">{t("diary.title")}</h1>
                      {stats && (
                        <p className="text-[11px] text-tx-tertiary mt-0.5">
                          {t("diary.statsLine")
                            .replace("{{total}}", String(stats.total))
                            .replace("{{today}}", String(stats.todayCount))}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 发布框 — 列表模式下显示 */}
              {viewMode === "list" && (
                <div className="hidden md:block">
                  <ComposeBox onPost={handlePost} />
                </div>
              )}

              {/* 过滤状态指示器 */}
              {(activeFilterLabel || searchTermsList.length > 0) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-tx-secondary py-1 select-none animate-in fade-in duration-200">
                  <span className="text-tx-tertiary">Filter:</span>
                  {searchTermsList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const nextMode = searchMode === "AND" ? "OR" : "AND";
                        setSearchMode(nextMode);
                        try {
                          sessionStorage.setItem("super-diary-search-mode", JSON.stringify(nextMode));
                        } catch {}
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-[10px] font-semibold hover:bg-accent-primary/20 active:scale-95 transition-all select-none cursor-pointer"
                    >
                      <span>关系: {searchMode === "AND" ? "并且 (AND)" : "或者 (OR)"}</span>
                    </button>
                  )}
                  {activeFilterLabel && (
                    <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-app-hover border border-app-border/40 text-tx-secondary text-[11px] font-medium">
                      {activeFilterLabel.icon}
                      <span>{activeFilterLabel.name}</span>
                      <button
                        type="button"
                        onClick={() => setFilterMode("all")}
                        className="text-tx-tertiary hover:text-tx-primary p-0.5 rounded transition-colors"
                        title="清除过滤"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  )}
                  {searchTermsList.map((term: string, index: number) => (
                    <div key={index} className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-app-hover border border-app-border/40 text-tx-secondary text-[11px] font-medium animate-in zoom-in-95 duration-150">
                      <span>{term}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = searchTermsList.filter((_: string, i: number) => i !== index).join(" ");
                          setDiarySearchQuery(updated);
                          try {
                            sessionStorage.setItem("super-diary-search-query", JSON.stringify(updated));
                          } catch {}
                        }}
                        className="text-tx-tertiary hover:text-tx-primary p-0.5 rounded transition-colors"
                        title="清除"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 日历视图 / 时间线 */}
              {viewMode === "calendar" ? (
                <div className="py-4">
                  <DiaryCalendar
                    onDateSelect={handleCalendarDateSelect}
                    tagId={(filterMode !== "all" && filterMode !== "public" && filterMode !== "private" && filterMode !== "liked") ? filterMode : undefined}
                    search={debouncedSearch || undefined}
                    searchMode={searchMode}
                  />
                </div>
              ) : loading ? (
                <div className="flex justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-accent-primary" />
                </div>
              ) : displayedItems.length === 0 ? (
                <div className="flex flex-col items-center py-20 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-app-hover/60 flex items-center justify-center mb-4">
                    <MessageCircle size={28} className="text-tx-tertiary" />
                  </div>
                  <p className="text-sm text-tx-secondary font-medium">
                    {isFiltering ? t("diary.emptyFiltered") : t("diary.empty")}
                  </p>
                  <p className="text-xs text-tx-tertiary mt-1">
                    {isFiltering ? t("diary.emptyFilteredHint") : t("diary.emptyHint")}
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* 置顶动态区 */}
                  {pinnedItems.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 bg-emerald-500/10 dark:bg-emerald-500/20 px-2.5 py-1 rounded-full">
                          <Pin size={11} className="fill-emerald-600 animate-in fade-in" />
                          置顶动态
                        </span>
                        <div className="flex-1 h-px bg-emerald-500/20" />
                      </div>
                      <div className="space-y-3">
                        <AnimatePresence mode="popLayout">
                          {pinnedItems.map((item) => (
                            <motion.div
                              layout
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.2 }}
                              key={item.id}
                            >
                              <DiaryCard
                                item={item}
                                onDelete={handleDelete}
                                onUpdate={handleUpdate}
                                isHighlighted={highlightedId === item.id}
                                search={debouncedSearch || undefined}
                                onTagClick={handleTagClick}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}

                  {/* 时间线分割线 (若既有置顶又有普通) */}
                  {pinnedItems.length > 0 && unpinnedItems.length > 0 && (
                    <div className="my-5 border-t border-app-border/40" />
                  )}

                  {/* 普通动态区 */}
                  {groupedItems.map(({ label, items: dayItems }) => (
                    <div key={label}>
                      {/* 日期分割 */}
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-[11px] font-medium text-tx-tertiary bg-app-hover/60 px-2.5 py-1 rounded-full">
                          {label}
                        </span>
                        <div className="flex-1 h-px bg-app-border/50" />
                      </div>

                      {/* 当天动态 */}
                      <div className="space-y-3">
                        <AnimatePresence mode="popLayout">
                          {dayItems.map((item) => (
                            <motion.div
                              layout
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.2 }}
                              key={item.id}
                            >
                              <DiaryCard
                                key={item.id}
                                item={item}
                                onDelete={handleDelete}
                                onUpdate={handleUpdate}
                                isHighlighted={highlightedId === item.id}
                                search={debouncedSearch || undefined}
                                onTagClick={handleTagClick}
                              />
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </div>
                  ))}

                  {/* 加载更多 */}
                  {hasMore && (
                    <div className="flex justify-center pt-2 pb-4">
                      <button
                        onClick={() => loadTimeline(false)}
                        disabled={loadingMore}
                        className="flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-medium text-tx-secondary bg-app-hover/60 hover:bg-app-hover transition-colors"
                      >
                        {loadingMore ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <ChevronDown size={13} />
                        )}
                        <span>{loadingMore ? t("diary.loadingMore") : t("diary.loadMore")}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollContainer>
        </PullToRefresh>
      </div>

      {/* 右侧边栏：搜索框 + 热力图 + 标签筛选 */}
      <div className="hidden md:flex w-[260px] min-w-[260px] shrink-0 flex-col bg-app-surface border-l border-app-border/50 overflow-y-auto px-5 py-4 gap-5 diary-project-sidebar">

        {/* 搜索框 */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary" />
          <Input
            placeholder={t('diary.searchPlaceholder') || "搜索说说..."}
            className="pl-8 h-8 text-xs bg-app-bg border-app-border no-focus-ring"
            value={diarySearchQuery}
            onChange={handleDiarySearchChange}
          />
        </div>

        {/* 说说动态 (热力图) */}
        <div className="px-0.5">
          <DiaryHeatMap
            stats={useMemo(() => {
              const counts: Record<string, number> = {};
              for (const item of items) {
                const dateStr = item.createdAt.split(" ")[0]; // YYYY-MM-DD
                counts[dateStr] = (counts[dateStr] || 0) + 1;
              }
              return Object.entries(counts).map(([date, count]) => ({ date, count }));
            }, [items])}
            onDateSelect={handleCalendarDateSelect}
          />
        </div>

        {/* 标签与分类筛选 */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-tx-primary px-1">
            分类与标签
          </div>
          <div className="space-y-1">

            {/* 公开 */}
            <button
              onClick={() => setFilterMode("public")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                filterMode === "public"
                  ? "bg-accent-primary/10 text-accent-primary font-medium"
                  : "text-tx-secondary hover:bg-app-hover"
              )}
            >
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <span>🌐 公开</span>
            </button>

            {/* 仅自己可见 */}
            <button
              onClick={() => setFilterMode("private")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                filterMode === "private"
                  ? "bg-accent-primary/10 text-accent-primary font-medium"
                  : "text-tx-secondary hover:bg-app-hover"
              )}
            >
              <span className="w-2 h-2 rounded-full bg-zinc-500 shrink-0" />
              <span>🔒 仅自己可见</span>
            </button>

            {/* 我赞过的 */}
            <button
              onClick={() => setFilterMode("liked")}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                filterMode === "liked"
                  ? "bg-accent-primary/10 text-accent-primary font-medium"
                  : "text-tx-secondary hover:bg-app-hover"
              )}
            >
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
              <span>❤️ 我赞过的</span>
            </button>

            {/* 标签分割线 */}
            {state.tags.length > 0 && (
              <div className="h-px bg-app-border/40 my-2" />
            )}

            {/* 自定义标签 */}
            {state.tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => {
                  if (tagLongPressFired.current) {
                    tagLongPressFired.current = false;
                    return;
                  }
                  setFilterMode(filterMode === tag.id ? "all" : tag.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTagColorPopover({
                    tagId: tag.id,
                    tagName: tag.name,
                    color: tag.color,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  if (!touch) return;
                  const startX = touch.clientX;
                  const startY = touch.clientY;
                  tagLongPressFired.current = false;
                  if (tagLongPressTimer.current) clearTimeout(tagLongPressTimer.current);
                  tagLongPressTimer.current = setTimeout(() => {
                    tagLongPressFired.current = true;
                    setTagColorPopover({
                      tagId: tag.id,
                      tagName: tag.name,
                      color: tag.color,
                      x: startX,
                      y: startY,
                    });
                  }, 500);
                }}
                onTouchMove={() => {
                  if (tagLongPressTimer.current) {
                    clearTimeout(tagLongPressTimer.current);
                    tagLongPressTimer.current = null;
                  }
                }}
                onTouchEnd={() => {
                  if (tagLongPressTimer.current) {
                    clearTimeout(tagLongPressTimer.current);
                    tagLongPressTimer.current = null;
                  }
                }}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                  filterMode === tag.id
                    ? "bg-accent-primary/10 text-accent-primary font-medium"
                    : "text-tx-secondary hover:bg-app-hover"
                )}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getTagColor(tag) }} />
                <span className="truncate">{tag.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {tagColorPopover && (
        <TagColorPopover
          x={tagColorPopover.x}
          y={tagColorPopover.y}
          currentColor={tagColorPopover.color}
          title={tagColorPopover.tagName}
          onPick={async (color) => {
            try {
              await api.updateTag(tagColorPopover.tagId, { color });
              const allTags = await api.getTags();
              actions.setTags(allTags);
            } catch (err) {
              console.error("Failed to update tag color:", err);
            }
          }}
          onRename={async () => {
            const newName = window.prompt(t("tags.promptRename", "请输入新的标签名称"), tagColorPopover.tagName);
            if (newName === null) return;
            const trimmed = newName.trim();
            if (!trimmed) {
              alert(t("tags.nameRequired", "标签名称不能为空"));
              return;
            }
            try {
              await api.updateTag(tagColorPopover.tagId, { name: trimmed });
              const allTags = await api.getTags();
              actions.setTags(allTags);
            } catch (err) {
              console.error("Failed to rename tag:", err);
            }
          }}
          onDelete={async () => {
            const ok = await confirmDialog({
              title: t("sidebar.deleteTagTitle"),
              description: t("sidebar.confirmDeleteTag", { name: tagColorPopover.tagName }),
              danger: true,
            });
            if (!ok) return;
            try {
              await api.deleteTag(tagColorPopover.tagId);
              if (filterMode === tagColorPopover.tagId) {
                setFilterMode("all");
              }
              if (state.selectedTagId === tagColorPopover.tagId) {
                actions.setSelectedTag(null);
                actions.setViewMode("all");
              }
              const allTags = await api.getTags();
              actions.setTags(allTags);
            } catch (err) {
              console.error("Failed to delete tag:", err);
            }
          }}
          onClose={() => setTagColorPopover(null)}
        />
      )}
      </div>
    </div>
  );
}


// ============================================================
// 辅助：按日期分组
// ============================================================
function groupByDate(
  items: Diary[],
  t: (key: string) => string
): { label: string; items: Diary[] }[] {
  const groups: Map<string, Diary[]> = new Map();
  const today = new Date();
  const todayStr = formatDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDateKey(yesterday);

  for (const item of items) {
    const date = new Date(item.createdAt.replace(" ", "T") + "Z");
    const key = formatDateKey(date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return Array.from(groups.entries()).map(([key, dayItems]) => {
    let label = key;
    if (key === todayStr) label = t("diary.today");
    else if (key === yesterdayStr) label = t("diary.yesterday");
    return { label, items: dayItems };
  });
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
