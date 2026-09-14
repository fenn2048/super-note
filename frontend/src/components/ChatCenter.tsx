/**
 * 家庭工作区 IM：群 + 成员私聊。
 * 桌面双栏；移动先列表后全屏会话。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  ListTodo,
  MessageCircle,
  Mic,
  Paperclip,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Share2,
  Smile,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { registerPlugin } from "@capacitor/core";
import { EmojiPicker } from "@/components/EmojiPicker";
import { api, getCurrentWorkspace, resolveAttachmentUrl } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import { useAppActions } from "@/store/AppContext";
import type { ImConversation, ImMessage, ImMessageCursor, ImSearchHit, ImSticker, UserPublicInfo, WorkspaceMember, WorkspaceRole } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { copyText } from "@/lib/clipboard";
import { createUnifiedTask } from "@/lib/taskEntry";
import { confirm } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { fieldControlClass } from "@/components/ui/field";
import MentionPicker, { parseMentionTrigger, replaceMentionText } from "@/components/MentionPicker";
import { haptic } from "@/hooks/useCapacitor";
import {
  createVoiceMediaRecorder,
  getVoiceMediaStream,
  voiceBlobFromChunks,
  voiceFileFromBlob,
} from "@/lib/voiceRecorder";
import {
  EmptyState,
  EmptyActionButton,
  LoadingBlock,
  ErrorBanner,
} from "@/components/common/FeedbackStates";
import { BottomSheet } from "@/components/common/BottomSheet";
import MobileChromeHeader, { MobileChromeIconButton } from "@/components/common/MobileChromeHeader";
import PageHeader from "@/components/layout/PageHeader";
import { Motion } from "@/components/common/Motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";
import { openChat, parseChatHash } from "@/lib/navigation.config";
import { useRegisterBackLayer } from "@/hooks/useMobileBackStack";
import { easings, springs } from "@/lib/motion";
import { cardPreview } from "@/lib/imCard";
import { ImShareCardBubble, ShareItemPickerSheet } from "@/components/chat/ShareToChat";

function selfUserId(): string {
  try {
    return localStorage.getItem("super-self-userid") || "";
  } catch {
    return "";
  }
}

function selfUsername(): string {
  try {
    return localStorage.getItem("super-self-username") || "";
  } catch {
    return "";
  }
}

const MENTION_RE = /@([\w一-鿿-]+)/g;

function MessageBody({ text, query }: { text: string; query?: string }) {
  const me = selfUsername();
  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(MENTION_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(highlightSlice(text.slice(last, m.index), query, last));
    const isMe = me && m[1] === me;
    parts.push(
      <span
        key={`m-${m.index}`}
        className={cn("font-medium text-accent-primary", isMe && "underline decoration-accent-primary/50")}
      >
        @{m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(highlightSlice(text.slice(last), query, last));
  return <span className="whitespace-pre-wrap">{parts.length ? parts : text}</span>;
}

function highlightSlice(chunk: string, query: string | undefined, keyBase: number): React.ReactNode {
  if (!query || !chunk) return chunk;
  const q = query.trim();
  if (!q) return chunk;
  const lower = chunk.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let from = 0;
  let i = lower.indexOf(needle, from);
  let n = 0;
  while (i >= 0) {
    if (i > from) out.push(chunk.slice(from, i));
    out.push(
      <mark
        key={`h-${keyBase}-${n++}`}
        className="bg-accent-warning/25 text-inherit rounded-[2px] px-0.5"
      >
        {chunk.slice(i, i + q.length)}
      </mark>,
    );
    from = i + q.length;
    i = lower.indexOf(needle, from);
  }
  if (from < chunk.length) out.push(chunk.slice(from));
  return out.length === 1 ? out[0] : out;
}

const BUBBLE_TINTS: Array<{ color: string; pct: number }> = [
  { color: "var(--color-accent-primary)", pct: 18 },
  { color: "var(--color-accent-secondary)", pct: 18 },
  { color: "var(--color-accent-warning)", pct: 16 },
  { color: "var(--color-accent-danger)", pct: 12 },
  { color: "var(--color-accent-primary)", pct: 12 },
  { color: "var(--color-accent-secondary)", pct: 12 },
  { color: "var(--color-accent-warning)", pct: 22 },
  { color: "var(--color-accent-primary)", pct: 26 },
];

function hashSender(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 浅色 tint + 主文字色，保证浅色/深色主题都可读 */
function imPreview(m: { type: string; body?: string | null; file?: { filename?: string } | null }): string {
  if (m.type === "image") return "[图片]";
  if (m.type === "sticker") return "[表情]";
  if (m.type === "voice") return "[语音]";
  if (m.type === "file") return m.file?.filename ? `[文件] ${m.file.filename}` : "[文件]";
  if (m.type === "card") return cardPreview(m.body);
  return (m.body || "").replace(/\s+/g, " ").trim();
}

function messageCopyText(m: ImMessage): string {
  if (m.type === "card") return cardPreview(m.body);
  if (m.type === "text") return (m.body || "").trim();
  return imPreview(m);
}

function messageTaskTitle(m: ImMessage): string {
  if (m.type === "text") {
    const t = (m.body || "").replace(/\s+/g, " ").trim();
    if (!t) return "未命名任务";
    return t.length > 80 ? t.slice(0, 80) : t;
  }
  return imPreview(m) || "未命名任务";
}

async function fetchMessageFile(m: ImMessage): Promise<File> {
  if (!m.file?.url) throw new Error("没有可转存的附件");
  const res = await fetch(resolveAttachmentUrl(m.file.url));
  if (!res.ok) throw new Error("下载附件失败");
  const blob = await res.blob();
  const type = blob.type || m.file.mimeType || "application/octet-stream";
  return new File([blob], m.file.filename || "file", { type });
}

function isStickerMessage(m: { type?: string; body?: string | null }): boolean {
  if ((m.type || "").toLowerCase() === "sticker") return true;
  const b = (m.body || "").trim();
  return b.startsWith("/emojis/") || b.startsWith("sticker:");
}

function stickerSrc(m: ImMessage): string {
  if (m.file?.url) return resolveAttachmentUrl(m.file.url);
  const b = (m.body || "").trim();
  if (b.startsWith("sticker:")) return resolveAttachmentUrl(`/api/im/stickers/${b.slice(8)}`);
  if (b.startsWith("/emojis/")) return resolveAttachmentUrl(b);
  return "";
}

function formatVoiceClock(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function voiceWaveform(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    out.push(0.22 + ((h >>> 0) % 78) / 100);
  }
  return out;
}

const voiceBus = typeof window !== "undefined" ? new EventTarget() : null;

function VoiceBubble({ src, duration }: { src: string; duration: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const tokenRef = useRef(`${Date.now()}-${Math.random()}`);
  const total = Math.max(1, duration);
  const bars = useMemo(() => voiceWaveform(src, 12), [src]);

  const readElapsed = useCallback(() => {
    const a = audioRef.current;
    const t = a && Number.isFinite(a.currentTime) ? a.currentTime : 0;
    return Math.min(Math.max(0, t), total);
  }, [total]);

  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = "auto";
    try {
      audio.setAttribute("playsinline", "true");
    } catch {
      /* ignore */
    }
    audioRef.current = audio;
    const onEnd = () => {
      setPlaying(false);
      setElapsed(0);
      if (audioRef.current) audioRef.current.currentTime = 0;
    };
    const onTime = () => setElapsed(readElapsed());
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("timeupdate", onTime);
    const onForeignPlay = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id !== tokenRef.current && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setPlaying(false);
      }
    };
    voiceBus?.addEventListener("play", onForeignPlay);
    return () => {
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("timeupdate", onTime);
      voiceBus?.removeEventListener("play", onForeignPlay);
      audioRef.current = null;
    };
  }, [src, readElapsed]);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    let lastShown = -1;
    const loop = () => {
      const t = readElapsed();
      const sec = Math.floor(t);
      if (sec !== lastShown) {
        lastShown = sec;
        setElapsed(t);
      } else {
        setElapsed(t);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, readElapsed]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      setElapsed(readElapsed());
      return;
    }
    voiceBus?.dispatchEvent(new CustomEvent("play", { detail: tokenRef.current }));
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => toast.error("无法播放语音"));
  };

  const remain = Math.max(0, total - elapsed);
  const clock = playing ? formatVoiceClock(remain) : formatVoiceClock(total);
  const width = Math.min(176, 112 + Math.min(total, 60) * 1.05);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      className="flex items-center gap-2 h-7"
      style={{ width }}
      aria-label={playing ? "暂停语音" : "播放语音"}
    >
      <Motion.span
        className="w-6 h-6 rounded-full bg-tx-primary text-app-bg flex items-center justify-center shrink-0"
        animate={{ scale: playing ? 1.06 : 1 }}
        transition={springs.snappy}
      >
        {playing ? <Pause size={12} /> : <Play size={12} className="ml-px" fill="currentColor" />}
      </Motion.span>
      <span className="flex-1 min-w-0 overflow-hidden flex items-end gap-px h-4" aria-hidden>
        {bars.map((rest, i) => (
          <Motion.span
            key={i}
            className="block flex-1 min-w-0 max-w-[3px] rounded-full bg-tx-primary origin-bottom"
            style={{ height: 16 }}
            animate={
              playing
                ? { scaleY: [Math.max(0.2, rest * 0.35), 1, Math.max(0.25, rest * 0.5), rest] }
                : { scaleY: rest }
            }
            transition={
              playing
                ? {
                    duration: 0.64 + (i % 4) * 0.07,
                    repeat: Infinity,
                    ease: easings.inOut,
                    delay: (i % 5) * 0.05,
                  }
                : springs.snappy
            }
          />
        ))}
      </span>
      <span className="text-[12px] font-semibold tabular-nums text-tx-primary shrink-0 w-8 text-right pl-1">
        {clock}
      </span>
    </button>
  );
}

function bubbleStyle(senderId: string, mine: boolean): React.CSSProperties {
  const tint = mine
    ? { color: "var(--color-accent-primary)", pct: 22 }
    : BUBBLE_TINTS[hashSender(senderId) % BUBBLE_TINTS.length];
  return {
    backgroundColor: `color-mix(in srgb, ${tint.color} ${tint.pct}%, var(--color-elevated))`,
    borderColor: `color-mix(in srgb, ${tint.color} 32%, var(--color-border))`,
    color: "var(--color-text-primary)",
  };
}

function parseMsgDate(raw: string): Date {
  if (!raw) return new Date();
  if (raw.includes("T")) return new Date(raw);
  return new Date(raw.replace(" ", "T") + "Z");
}

function formatClock(raw: string): string {
  const d = parseMsgDate(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatListTime(raw: string | null): string {
  if (!raw) return "";
  const d = parseMsgDate(raw);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return formatClock(raw);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "昨天";
  }
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function dayLabel(raw: string): string {
  const d = parseMsgDate(raw);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "今天";
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

function formatSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function initials(name: string | null | undefined): string {
  const s = (name || "").trim();
  return s ? s.slice(0, 1).toUpperCase() : "?";
}

function MessageActionRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 min-h-12 px-3 rounded-button text-left text-sm",
        "active:scale-[0.97] transition-transform duration-press ease-out",
        disabled && "opacity-40 pointer-events-none",
        danger ? "text-accent-danger" : "text-tx-primary",
      )}
    >
      <Icon size={18} className={danger ? "text-accent-danger" : "text-tx-secondary"} />
      {label}
    </button>
  );
}

function ComposerMoreTile({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 min-h-11 px-1 py-1 rounded-button text-tx-secondary active:scale-[0.97] transition-transform duration-press ease-out disabled:opacity-50 disabled:pointer-events-none"
    >
      <span className="w-14 h-14 rounded-card bg-app-elevated border border-app-border flex items-center justify-center text-tx-primary shadow-xs">
        <Icon size={22} />
      </span>
      <span className="text-[11px] leading-none">{label}</span>
    </button>
  );
}

function Avatar({
  name,
  url,
  size = 36,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  const src = url ? resolveAttachmentUrl(url) : "";
  return (
    <div
      className="shrink-0 rounded-full bg-accent-primary/12 text-accent-primary flex items-center justify-center font-semibold overflow-hidden"
      style={{ width: size, height: size, fontSize: size < 32 ? 11 : 13 }}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        initials(name)
      )}
    </div>
  );
}

export default function ChatCenter() {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { height: kbHeight } = useKeyboardVisible();
  const actions = useAppActions();
  const me = selfUserId();

  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspace());
  const [conversations, setConversations] = useState<ImConversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => parseChatHash(window.location.hash)?.conversationId || null);

  const [messages, setMessages] = useState<ImMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [loadingBefore, setLoadingBefore] = useState(false);
  const [loadingAfter, setLoadingAfter] = useState(false);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [hasMoreAfter, setHasMoreAfter] = useState(false);
  const [beforeCursor, setBeforeCursor] = useState<ImMessageCursor | null>(null);
  const [afterCursor, setAfterCursor] = useState<ImMessageCursor | null>(null);
  const [draft, setDraft] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [threadQuery, setThreadQuery] = useState("");
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [listHits, setListHits] = useState<ImSearchHit[]>([]);
  const [threadHits, setThreadHits] = useState<ImSearchHit[]>([]);
  const [searchingList, setSearchingList] = useState(false);
  const [searchingThread, setSearchingThread] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [actionMsgId, setActionMsgId] = useState<string | null>(null);
  const [stickers, setStickers] = useState<ImSticker[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const RECORD_WAVE_BARS = 36;
  const [recordWave, setRecordWave] = useState<number[]>(() => new Array(36).fill(0.08));
  const recordWaveRef = useRef<number[]>(new Array(36).fill(0.08));
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [myRole, setMyRole] = useState<WorkspaceRole | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cursorPos, setCursorPos] = useState(0);
  const [mentionClosed, setMentionClosed] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartedRef = useRef(0);
  const waveformAnimRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stickBottomRef = useRef(true);
  const pressTimerRef = useRef<number | null>(null);
  const skipClickRef = useRef(false);
  const longPressArmedRef = useRef(false);
  const suppressContextMenuRef = useRef(0);
  const { menu, menuRef, openMenu, closeMenu } = useContextMenu();
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const hasMoreAfterRef = useRef(false);
  hasMoreAfterRef.current = hasMoreAfter;
  const loadingBeforeRef = useRef(false);
  const loadingAfterRef = useRef(false);
  const pendingAroundRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const personal = !workspaceId || workspaceId === "personal";
  const active = conversations.find((c) => c.id === activeId) || null;
  const canModerate = myRole === "owner" || myRole === "admin";
  const mentionCandidates: UserPublicInfo[] = useMemo(
    () =>
      members.map((m) => ({
        id: m.userId,
        username: m.username,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
      })),
    [members],
  );
  const mentionTrigger =
    !mentionClosed && active?.type === "group"
      ? parseMentionTrigger(draft, cursorPos)
      : null;
  const actionMsg = actionMsgId ? messages.find((m) => m.id === actionMsgId) || null : null;

  const refreshUnread = useCallback(() => {
    if (personal) {
      actions.setChatUnreadCount(0);
      return;
    }
    api.im.unreadCount().then((r) => actions.setChatUnreadCount(r.count)).catch(() => {});
  }, [actions, personal]);

  const loadConversations = useCallback(async () => {
    if (personal) {
      setConversations([]);
      setListLoading(false);
      setListError(null);
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const data = await api.im.conversations();
      setConversations(data.items);
      actions.setChatUnreadCount(data.items.reduce((s, c) => s + (c.unreadCount || 0), 0));
    } catch (e: any) {
      setListError(e?.message || "加载会话失败");
    } finally {
      setListLoading(false);
    }
  }, [personal, actions]);

  useEffect(() => {
    const syncWs = () => {
      setWorkspaceId(getCurrentWorkspace());
      setActiveId(null);
      openChat(null);
    };
    window.addEventListener("super:workspace-changed", syncWs);
    return () => window.removeEventListener("super:workspace-changed", syncWs);
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (personal) {
      setMembers([]);
      setMyRole(null);
      return;
    }
    const ws = getCurrentWorkspace();
    if (!ws) return;
    api
      .getWorkspaceMembers(ws)
      .then((list) => {
        setMembers(list.filter((m) => m.userId !== me));
        setMyRole(list.find((m) => m.userId === me)?.role ?? null);
      })
      .catch(() => {
        setMembers([]);
        setMyRole(null);
      });
  }, [personal, workspaceId, me]);

  useEffect(() => {
    if (listLoading || !activeId || conversations.length === 0) return;
    if (!conversations.some((c) => c.id === activeId)) {
      setActiveId(null);
      openChat(null);
    }
  }, [listLoading, activeId, conversations]);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseChatHash(window.location.hash);
      if (!parsed) return;
      setActiveId(parsed.conversationId);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const applyPageMeta = useCallback(
    (
      data: {
        hasMoreBefore: boolean;
        hasMoreAfter: boolean;
        beforeCursor: ImMessageCursor | null;
        afterCursor: ImMessageCursor | null;
      },
      mode: "reset" | "before" | "after",
    ) => {
      if (mode === "reset") {
        setHasMoreBefore(data.hasMoreBefore);
        setHasMoreAfter(data.hasMoreAfter);
        setBeforeCursor(data.beforeCursor);
        setAfterCursor(data.afterCursor);
        return;
      }
      if (mode === "before") {
        setHasMoreBefore(data.hasMoreBefore);
        if (data.beforeCursor) setBeforeCursor(data.beforeCursor);
        return;
      }
      setHasMoreAfter(data.hasMoreAfter);
      if (data.afterCursor) setAfterCursor(data.afterCursor);
    },
    [],
  );

  const markConvRead = useCallback(
    async (conversationId: string) => {
      await api.im.markRead(conversationId);
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
      );
      refreshUnread();
      actions.refreshMentionCount();
    },
    [actions, refreshUnread],
  );

  const loadLatest = useCallback(
    async (conversationId: string) => {
      setMsgLoading(true);
      try {
        const data = await api.im.messages(conversationId, { limit: 30 });
        setMessages(data.items);
        applyPageMeta(data, "reset");
        stickBottomRef.current = true;
        await markConvRead(conversationId);
      } catch (e: any) {
        toast.error(e?.message || "加载消息失败");
      } finally {
        setMsgLoading(false);
      }
    },
    [applyPageMeta, markConvRead],
  );

  const loadOlder = useCallback(
    async (conversationId: string) => {
      if (loadingBeforeRef.current || !hasMoreBefore || !beforeCursor) return;
      loadingBeforeRef.current = true;
      const el = scrollerRef.current;
      if (el) pendingRestoreRef.current = { height: el.scrollHeight, top: el.scrollTop };
      setLoadingBefore(true);
      try {
        const data = await api.im.messages(conversationId, { before: beforeCursor, limit: 30 });
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const older = data.items.filter((m) => !ids.has(m.id));
          return [...older, ...prev];
        });
        applyPageMeta(data, "before");
      } catch (e: any) {
        pendingRestoreRef.current = null;
        toast.error(e?.message || "加载更早消息失败");
      } finally {
        loadingBeforeRef.current = false;
        setLoadingBefore(false);
      }
    },
    [hasMoreBefore, beforeCursor, applyPageMeta],
  );

  const loadNewer = useCallback(
    async (conversationId: string) => {
      if (loadingAfterRef.current || !hasMoreAfter || !afterCursor) return;
      loadingAfterRef.current = true;
      setLoadingAfter(true);
      try {
        const data = await api.im.messages(conversationId, { after: afterCursor, limit: 30 });
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const newer = data.items.filter((m) => !ids.has(m.id));
          return [...prev, ...newer];
        });
        applyPageMeta(data, "after");
      } catch (e: any) {
        toast.error(e?.message || "加载更新消息失败");
      } finally {
        loadingAfterRef.current = false;
        setLoadingAfter(false);
      }
    },
    [hasMoreAfter, afterCursor, applyPageMeta],
  );

  const flashMessage = useCallback((id: string) => {
    setHighlightId(id);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightId(null), 1600);
    requestAnimationFrame(() => {
      const node = scrollerRef.current?.querySelector(`[data-msg-id="${id}"]`);
      node?.scrollIntoView({ block: "center" });
    });
  }, []);

  const loadAround = useCallback(
    async (conversationId: string, messageId: string) => {
      setMsgLoading(true);
      stickBottomRef.current = false;
      try {
        const data = await api.im.messages(conversationId, { around: messageId, limit: 30 });
        setMessages(data.items);
        applyPageMeta(data, "reset");
        await markConvRead(conversationId);
        requestAnimationFrame(() => flashMessage(messageId));
      } catch (e: any) {
        toast.error(e?.message || "无法定位该消息");
        await loadLatest(conversationId);
      } finally {
        setMsgLoading(false);
      }
    },
    [applyPageMeta, markConvRead, flashMessage, loadLatest],
  );

  const jumpToMessage = useCallback(
    (conversationId: string, messageId: string) => {
      setThreadSearchOpen(false);
      setListQuery("");
      if (activeIdRef.current === conversationId && messages.some((m) => m.id === messageId)) {
        flashMessage(messageId);
        return;
      }
      pendingAroundRef.current = messageId;
      if (activeIdRef.current === conversationId) {
        void loadAround(conversationId, messageId);
        pendingAroundRef.current = null;
      } else {
        setActiveId(conversationId);
        openChat(conversationId);
      }
    },
    [messages, flashMessage, loadAround],
  );

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setHasMoreBefore(false);
      setHasMoreAfter(false);
      setBeforeCursor(null);
      setAfterCursor(null);
      return;
    }
    const around = pendingAroundRef.current;
    pendingAroundRef.current = null;
    if (around) void loadAround(activeId, around);
    else void loadLatest(activeId);
    setSelecting(false);
    setSelectedIds(new Set());
    setThreadQuery("");
    setThreadHits([]);
    setThreadSearchOpen(false);
    realtime.subscribe(`im:${activeId}`);
    return () => {
      realtime.unsubscribe(`im:${activeId}`);
    };
  }, [activeId, loadLatest, loadAround]);

  useLayoutEffect(() => {
    const restore = pendingRestoreRef.current;
    const el = scrollerRef.current;
    if (!restore || !el) return;
    pendingRestoreRef.current = null;
    el.scrollTop = restore.top + (el.scrollHeight - restore.height);
  }, [messages]);

  useEffect(() => {
    if (kbHeight <= 0 || !stickBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [kbHeight]);

  useEffect(() => {
    const off = realtime.on("im:message", (msg: any) => {
      const incoming = msg?.message as ImMessage | undefined;
      const convId = msg?.conversationId || incoming?.conversationId;
      if (!incoming?.id || !convId) return;
      if (convId === activeIdRef.current && !hasMoreAfterRef.current) {
        setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
        if (incoming.senderId === selfUserId() || stickBottomRef.current) {
          stickBottomRef.current = true;
        }
        void api.im.markRead(convId).then(() => {
          refreshUnread();
          actions.refreshMentionCount();
        });
      }
      setConversations((prev) => {
        const next = prev.map((c) => {
          if (c.id !== convId) return c;
          const preview = imPreview(incoming);
          return {
            ...c,
            lastPreview: preview,
            lastMessageAt: incoming.createdAt,
            lastSenderId: incoming.senderId,
            unreadCount:
              convId === activeIdRef.current || incoming.senderId === selfUserId()
                ? 0
                : (c.unreadCount || 0) + 1,
          };
        });
        next.sort((a, b) => {
          if (a.type === "group" && b.type !== "group") return -1;
          if (a.type !== "group" && b.type === "group") return 1;
          return (b.lastMessageAt || b.updatedAt).localeCompare(a.lastMessageAt || a.updatedAt);
        });
        return next;
      });
      if (convId !== activeIdRef.current) refreshUnread();
    });
    const offDeleted = realtime.on("im:deleted", (msg: any) => {
      const convId = msg?.conversationId as string | undefined;
      if (!convId) return;
      const all = msg.all === true;
      const ids: string[] = Array.isArray(msg.ids) ? msg.ids : [];
      if (convId === activeIdRef.current) {
        setMessages((prev) => (all ? [] : prev.filter((m) => !ids.includes(m.id))));
        setSelectedIds((prev) => {
          if (all) return new Set();
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                lastPreview: msg.lastPreview ?? c.lastPreview,
                lastMessageAt: msg.lastMessageAt ?? c.lastMessageAt,
              }
            : c,
        ),
      );
    });
    const offConvDel = realtime.on("im:conversation-deleted", (msg: any) => {
      const convId = msg?.conversationId as string | undefined;
      if (!convId) return;
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeIdRef.current === convId) {
        setActiveId(null);
        openChat(null);
      }
      refreshUnread();
    });
    return () => {
      off();
      offDeleted();
      offConvDel();
    };
  }, [actions, refreshUnread]);

  useEffect(() => {
    if (!stickBottomRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

  useEffect(() => {
    setPlusOpen(false);
    setEmojiOpen(false);
    setActionMsgId(null);
    closeMenu();
  }, [activeId, closeMenu]);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
    openChat(id);
  }, []);

  const closeConversation = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
    setActiveId(null);
    openChat(null);
  }, []);

  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const canDeleteMessage = useCallback(
    (m: ImMessage) => m.senderId === me || canModerate,
    [me, canModerate],
  );

  const closeMessageActions = useCallback(() => {
    setActionMsgId(null);
    closeMenu();
  }, [closeMenu]);

  const copyMessage = useCallback(async (m: ImMessage) => {
    const text = messageCopyText(m);
    if (!text) {
      toast.error("没有可复制的内容");
      return;
    }
    const ok = await copyText(text);
    if (ok) toast.success("已复制");
    else toast.error("复制失败");
  }, []);

  const addMessageToTask = useCallback(async (m: ImMessage) => {
    const title = messageTaskTitle(m);
    const who = (m.senderName || "").trim() || "成员";
    const when = formatClock(m.createdAt);
    let description = `来自聊天 · ${who} · ${when}`;
    if (m.type === "text") {
      const full = (m.body || "").trim();
      if (full.length > 80) description = `${full}\n\n${description}`;
    }
    try {
      await createUnifiedTask({ title, description });
      toast.success("已添加到任务");
    } catch (err: any) {
      toast.error(err?.message || "添加到任务失败");
    }
  }, []);

  const addMessageToDiary = useCallback(async (m: ImMessage) => {
    if (isStickerMessage(m)) {
      toast.error("表情不能发到说说");
      return;
    }
    try {
      if (m.type === "image" && m.file) {
        const file = await fetchMessageFile(m);
        const uploaded = await api.diaryImages.upload(file);
        await api.postDiary({ contentText: "", images: [uploaded.id], visibility: "PUBLIC" });
      } else if (m.type === "voice" && m.file) {
        const file = await fetchMessageFile(m);
        const uploaded = await api.diaryImages.upload(file);
        const duration = Math.max(1, parseInt(m.body, 10) || 1);
        await api.postDiary({
          contentText: "",
          voice: { id: uploaded.id, duration },
          visibility: "PUBLIC",
        });
      } else {
        const contentText = messageCopyText(m);
        if (!contentText) {
          toast.error("没有可发布的内容");
          return;
        }
        await api.postDiary({ contentText, visibility: "PUBLIC" });
      }
      toast.success("已发布到说说");
    } catch (err: any) {
      toast.error(err?.message || "发布说说失败");
    }
  }, []);

  const deleteOneMessage = useCallback(
    async (m: ImMessage) => {
      if (!activeId) return;
      if (!canDeleteMessage(m)) {
        toast.error("没有权限删除这条消息");
        return;
      }
      const ok = await confirm({
        title: "删除这条消息",
        description: "删除后所有成员都看不到这条消息。",
        confirmText: "删除",
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.im.deleteMessages(activeId, { ids: [m.id] });
        const gone = new Set(res.deletedIds);
        setMessages((prev) => prev.filter((x) => !gone.has(x.id)));
        toast.success("已删除");
      } catch (err: any) {
        toast.error(err?.message || "删除失败");
      }
    },
    [activeId, canDeleteMessage],
  );

  const handleMessageAction = useCallback(
    async (actionId: string, m: ImMessage) => {
      closeMessageActions();
      if (actionId === "copy") await copyMessage(m);
      else if (actionId === "to-task") await addMessageToTask(m);
      else if (actionId === "to-diary") await addMessageToDiary(m);
      else if (actionId === "delete") await deleteOneMessage(m);
    },
    [closeMessageActions, copyMessage, addMessageToTask, addMessageToDiary, deleteOneMessage],
  );

  const messageMenuItems = useCallback(
    (m: ImMessage): ContextMenuItem[] => [
      { id: "copy", label: "复制", icon: <Copy size={14} /> },
      { id: "to-task", label: "添加到任务", icon: <ListTodo size={14} /> },
      {
        id: "to-diary",
        label: "添加到说说",
        icon: <BookOpen size={14} />,
        disabled: isStickerMessage(m),
      },
      { id: "sep-del", label: "", separator: true },
      {
        id: "delete",
        label: "删除",
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: !canDeleteMessage(m),
      },
    ],
    [canDeleteMessage],
  );

  const deleteConversation = useCallback(
    async (conv: ImConversation, e?: React.MouseEvent) => {
      e?.stopPropagation();
      e?.preventDefault();
      if (conv.type === "group") {
        toast.error("家庭群不能删除，请删除或清空消息");
        return;
      }
      const ok = await confirm({
        title: "删除对话",
        description: `删除与「${conv.title}」的私聊？双方都看不到这段记录。`,
        confirmText: "删除",
        danger: true,
      });
      if (!ok) return;
      try {
        await api.im.deleteConversation(conv.id);
        setConversations((prev) => prev.filter((c) => c.id !== conv.id));
        if (activeIdRef.current === conv.id) {
          setActiveId(null);
          openChat(null);
        }
        refreshUnread();
        toast.success("已删除对话");
      } catch (err: any) {
        toast.error(err?.message || "删除失败");
      }
    },
    [refreshUnread],
  );

  const deleteSelectedMessages = useCallback(async () => {
    if (!activeId || selectedIds.size === 0) return;
    const deletable = messages.filter((m) => selectedIds.has(m.id) && canDeleteMessage(m));
    if (deletable.length === 0) {
      toast.error("没有可删除的消息");
      return;
    }
    const ok = await confirm({
      title: `删除 ${deletable.length} 条消息`,
      description: "删除后所有成员都看不到这些消息。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.im.deleteMessages(activeId, { ids: deletable.map((m) => m.id) });
      const gone = new Set(res.deletedIds);
      setMessages((prev) => prev.filter((m) => !gone.has(m.id)));
      exitSelect();
      if (res.skipped) toast.success(`已删除 ${res.deletedIds.length} 条，跳过 ${res.skipped} 条`);
      else toast.success("已删除");
    } catch (err: any) {
      toast.error(err?.message || "删除失败");
    }
  }, [activeId, selectedIds, messages, canDeleteMessage, exitSelect]);

  const clearConversation = useCallback(async () => {
    if (!activeId || !active) return;
    if (active.type === "group" && !canModerate) {
      toast.error("只有管理员可以清空家庭群");
      return;
    }
    const ok = await confirm({
      title: "清空聊天记录",
      description: active.type === "group" ? "清空家庭群里的全部消息？" : "清空这段私聊的全部消息？",
      confirmText: "清空",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.im.deleteMessages(activeId, { all: true });
      setMessages([]);
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, lastPreview: "", lastMessageAt: null } : c)),
      );
      exitSelect();
      toast.success("已清空");
    } catch (err: any) {
      toast.error(err?.message || "清空失败");
    }
  }, [activeId, active, canModerate, exitSelect]);

  useRegisterBackLayer(
    "chat-select",
    selecting,
    exitSelect,
    260,
  );

  useRegisterBackLayer(
    "chat-emoji",
    emojiOpen,
    () => setEmojiOpen(false),
    258,
  );

  useRegisterBackLayer(
    "chat-plus",
    plusOpen,
    () => setPlusOpen(false),
    258,
  );

  useRegisterBackLayer(
    "chat-msg-actions",
    Boolean(actionMsgId),
    () => setActionMsgId(null),
    266,
  );

  useRegisterBackLayer(
    "chat-share",
    sharePickerOpen,
    () => setSharePickerOpen(false),
    262,
  );

  useRegisterBackLayer(
    "chat-record",
    recording,
    () => cancelRecording(),
    270,
  );

  useRegisterBackLayer(
    "chat-search",
    threadSearchOpen,
    () => {
      setThreadSearchOpen(false);
      setThreadQuery("");
      setThreadHits([]);
    },
    255,
  );

  useRegisterBackLayer(
    "chat-thread",
    Boolean(activeId) && !isDesktop && !selecting && !threadSearchOpen,
    closeConversation,
    250,
  );

  const sendText = useCallback(async () => {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    setSending(true);
    setDraft("");
    try {
      const sent = await api.im.send(activeId, { type: "text", body: text });
      if (hasMoreAfterRef.current) {
        await loadLatest(activeId);
      } else {
        setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
        stickBottomRef.current = true;
      }
    } catch (e: any) {
      setDraft(text);
      toast.error(e?.message || "发送失败");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [draft, activeId, sending, loadLatest]);

  const sendFile = useCallback(
    async (file: File, asImage: boolean) => {
      if (!activeId || sending) return;
      setSending(true);
      try {
        const uploaded = await api.im.uploadFile(activeId, file);
        const sent = await api.im.send(activeId, {
          type: asImage || uploaded.kind === "image" ? "image" : "file",
          fileId: uploaded.id,
        });
        if (hasMoreAfterRef.current) {
          await loadLatest(activeId);
        } else {
          setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
          stickBottomRef.current = true;
        }
      } catch (e: any) {
        toast.error(e?.message || "发送失败");
      } finally {
        setSending(false);
      }
    },
    [activeId, sending, loadLatest],
  );

  const appendSent = useCallback(
    async (sent: ImMessage) => {
      if (!activeId) return;
      if (hasMoreAfterRef.current) {
        await loadLatest(activeId);
        return;
      }
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      stickBottomRef.current = true;
    },
    [activeId, loadLatest],
  );

  const sendSticker = useCallback(
    async (body: string) => {
      if (!activeId || sending) return;
      setSending(true);
      setEmojiOpen(false);
      setPlusOpen(false);
      try {
        const sent = await api.im.send(activeId, { type: "sticker", body });
        await appendSent(sent);
      } catch (e: any) {
        toast.error(e?.message || "发送表情失败");
      } finally {
        setSending(false);
      }
    },
    [activeId, sending, appendSent],
  );

  const insertAtMention = useCallback(() => {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? draft.length;
    const needsSpace = pos > 0 && !/\s/.test(draft[pos - 1] || "");
    const insert = `${needsSpace ? " " : ""}@`;
    const next = draft.slice(0, pos) + insert + draft.slice(pos);
    setDraft(next);
    const caret = pos + insert.length;
    setCursorPos(caret);
    setMentionClosed(false);
    setPlusOpen(false);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }, [draft]);

  const sendVoiceFile = useCallback(
    async (file: File, duration: number) => {
      if (!activeId) return;
      setSending(true);
      try {
        const uploaded = await api.im.uploadFile(activeId, file);
        const sent = await api.im.send(activeId, {
          type: "voice",
          fileId: uploaded.id,
          body: String(Math.max(1, duration)),
        });
        await appendSent(sent);
      } catch (e: any) {
        toast.error(e?.message || "发送语音失败");
      } finally {
        setSending(false);
      }
    },
    [activeId, appendSent],
  );

  const stopRecordStreams = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (waveformAnimRef.current) {
      cancelAnimationFrame(waveformAnimRef.current);
      waveformAnimRef.current = 0;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const cancelRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.ondataavailable = null;
      rec.onstop = () => {
        audioChunksRef.current = [];
      };
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    stopRecordStreams();
    mediaRecorderRef.current = null;
    recordWaveRef.current = new Array(RECORD_WAVE_BARS).fill(0.08);
    setRecordWave(recordWaveRef.current.slice());
    setRecording(false);
    setRecordDuration(0);
  }, [stopRecordStreams]);

  const finishRecording = useCallback(async () => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") {
      cancelRecording();
      return;
    }
    mediaRecorderRef.current = null;
    const duration = Math.max(1, Math.round((Date.now() - recordStartedRef.current) / 1000));
    const mime = rec.mimeType;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    stopRecordStreams();
    mediaRecorderRef.current = null;
    setRecording(false);
    const blob = voiceBlobFromChunks(audioChunksRef.current, mime);
    audioChunksRef.current = [];
    if (blob.size < 256 || duration < 1) {
      toast.error("录音太短");
      setRecordDuration(0);
      return;
    }
    const file = voiceFileFromBlob(blob, "voice");
    await sendVoiceFile(file, Math.min(60, duration));
    setRecordDuration(0);
  }, [cancelRecording, sendVoiceFile, stopRecordStreams]);

  const startRecording = useCallback(async () => {
    if (recording || sending || !activeId) return;
    try {
      if (typeof window !== "undefined" && (window as any).Capacitor?.getPlatform?.() === "android") {
        try {
          const AppPermissions = registerPlugin<any>("AppPermissions");
          const micRes = await AppPermissions.requestMicrophonePermission();
          if (!micRes.granted) {
            toast.error("需要麦克风权限才能发送语音");
            return;
          }
        } catch {
          /* webview 继续走 getUserMedia */
        }
      }
      const stream = await getVoiceMediaStream();
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") await audioCtx.resume();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.28;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const timeDomain = new Uint8Array(analyser.fftSize);
      recordWaveRef.current = new Array(RECORD_WAVE_BARS).fill(0.08);
      setRecordWave(recordWaveRef.current.slice());
      let lastPaint = 0;
      const loop = (now: number) => {
        analyser.getByteTimeDomainData(timeDomain);
        let sum = 0;
        for (let i = 0; i < timeDomain.length; i++) {
          const v = (timeDomain[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / timeDomain.length);
        const level = Math.min(1, Math.pow(rms * 3.6, 0.85));
        const hist = recordWaveRef.current;
        hist.push(level);
        if (hist.length > RECORD_WAVE_BARS) hist.shift();
        if (now - lastPaint > 32) {
          lastPaint = now;
          setRecordWave(hist.slice());
        }
        waveformAnimRef.current = requestAnimationFrame(loop);
      };
      waveformAnimRef.current = requestAnimationFrame(loop);

      const rec = createVoiceMediaRecorder(stream);
      audioChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = rec;
      rec.start();
      haptic.light();
      recordStartedRef.current = Date.now();
      setRecording(true);
      setEmojiOpen(false);
      setPlusOpen(false);
      setRecordDuration(0);
      recordTimerRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - recordStartedRef.current) / 1000);
        setRecordDuration(sec);
        if (sec >= 60) {
          if (recordTimerRef.current) {
            clearInterval(recordTimerRef.current);
            recordTimerRef.current = null;
          }
          void finishRecording();
        }
      }, 200);
    } catch (err) {
      console.error(err);
      toast.error("无法启动录音，请检查麦克风权限");
      stopRecordStreams();
    }
  }, [recording, sending, activeId, finishRecording, stopRecordStreams]);

  const loadStickers = useCallback(() => {
    api.im
      .stickers()
      .then((r) => setStickers(r.items))
      .catch(() => setStickers([]));
  }, []);

  useEffect(() => {
    if (emojiOpen && !personal) loadStickers();
  }, [emojiOpen, personal, loadStickers]);

  useEffect(() => {
    return () => {
      cancelRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPicker = useCallback(async () => {
    const ws = getCurrentWorkspace();
    if (!ws) return;
    try {
      const list = await api.getWorkspaceMembers(ws);
      setMembers(list.filter((m) => m.userId !== me));
      setPickerOpen(true);
    } catch {
      toast.error("无法加载成员");
    }
  }, [me]);

  const startDm = useCallback(
    async (userId: string) => {
      try {
        const dm = await api.im.openDm(userId);
        setPickerOpen(false);
        await loadConversations();
        selectConversation(dm.id);
      } catch (e: any) {
        toast.error(e?.message || "无法开始私聊");
      }
    },
    [loadConversations, selectConversation],
  );

  const grouped = useMemo(() => {
    const out: Array<{ day: string; items: ImMessage[] }> = [];
    for (const m of messages) {
      const day = dayLabel(m.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [messages]);

  const filteredConversations = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.lastPreview || "").toLowerCase().includes(q),
    );
  }, [conversations, listQuery]);

  useEffect(() => {
    const q = listQuery.trim();
    if (q.length < 1) {
      setListHits([]);
      setSearchingList(false);
      return;
    }
    let cancelled = false;
    setSearchingList(true);
    const t = window.setTimeout(() => {
      api.im
        .search(q, { limit: 20 })
        .then((res) => {
          if (!cancelled) setListHits(res.items);
        })
        .catch(() => {
          if (!cancelled) setListHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingList(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [listQuery, workspaceId]);

  useEffect(() => {
    if (!threadSearchOpen) return;
    const q = threadQuery.trim();
    if (!activeId || q.length < 1) {
      setThreadHits([]);
      setSearchingThread(false);
      return;
    }
    let cancelled = false;
    setSearchingThread(true);
    const t = window.setTimeout(() => {
      api.im
        .search(q, { conversationId: activeId, limit: 30 })
        .then((res) => {
          if (!cancelled) setThreadHits(res.items);
        })
        .catch(() => {
          if (!cancelled) setThreadHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingThread(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [threadQuery, threadSearchOpen, activeId]);

  const showThread = Boolean(activeId) && (isDesktop || Boolean(activeId));
  const showList = isDesktop || !activeId;

  if (personal) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <MobileChromeHeader
          variant="stack"
          stackAction="back"
          title="聊天"
          onLeadingClick={() => actions.setViewMode("more")}
        />
        <PageHeader title="聊天" mdOnly />
        <EmptyState
          icon={MessageCircle}
          title="聊天仅在家庭工作区可用"
          description="切换到家庭工作区后，会自动出现家庭群，也可以和成员私聊。"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-app-bg">
      {showList && (
        <section
          className={cn(
            "flex flex-col min-h-0 border-app-border bg-app-bg",
            isDesktop ? "w-[300px] shrink-0 border-r" : "flex-1",
          )}
          style={!isDesktop && kbHeight > 0 ? { paddingBottom: kbHeight } : undefined}
        >
          <MobileChromeHeader
            variant="stack"
            stackAction="back"
            title="聊天"
            onLeadingClick={() => actions.setViewMode("more")}
            right={
              <MobileChromeIconButton title="发起私聊" onClick={openPicker}>
                <Plus size={18} />
              </MobileChromeIconButton>
            }
          />
          <PageHeader
            title="聊天"
            mdOnly
            actions={
              <Button variant="ghost" size="icon-lg" onClick={openPicker} aria-label="发起私聊">
                <Plus size={18} />
              </Button>
            }
          />
          <div className="px-3 pb-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-quaternary" />
              <input
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="搜索会话或消息"
                className={cn(fieldControlClass, "pl-8 pr-8")}
              />
              {listQuery && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-tx-quaternary"
                  aria-label="清除搜索"
                  onClick={() => setListQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {listLoading ? (
              <LoadingBlock label="加载会话…" />
            ) : listError ? (
              <ErrorBanner message={listError} onRetry={() => void loadConversations()} />
            ) : conversations.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title="还没有会话"
                description="家庭群会在工作区创建时自动出现。"
                action={
                  <EmptyActionButton onClick={openPicker}>发起私聊</EmptyActionButton>
                }
              />
            ) : (
              <>
              {listQuery.trim() && (
                <div className="px-4 py-1.5 text-[11px] font-medium text-tx-tertiary">
                  会话 {searchingList ? "…" : ""}
                </div>
              )}
              {listQuery.trim() && filteredConversations.length === 0 && listHits.length === 0 && !searchingList ? (
                <p className="px-4 py-6 text-sm text-tx-tertiary text-center">没有匹配的会话或消息</p>
              ) : null}
              <ul className="py-1">
                {filteredConversations.map((c) => {
                  const selected = c.id === activeId;
                  return (
                    <li key={c.id} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => selectConversation(c.id)}
                        className={cn(
                          "flex-1 flex items-center gap-3 px-4 min-h-12 py-2 text-left min-w-0",
                          "transition-[background-color] duration-fast ease-out",
                          selected ? "bg-app-active" : "hover:bg-app-hover",
                        )}
                      >
                        {c.type === "group" ? (
                          <div className="w-9 h-9 rounded-full bg-accent-primary/12 text-accent-primary flex items-center justify-center shrink-0">
                            <Users size={16} />
                          </div>
                        ) : (
                          <Avatar name={c.title} url={c.peerAvatarUrl} size={36} />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-tx-primary truncate">
                              {c.title}
                            </span>
                            <span className="ml-auto text-[11px] text-tx-quaternary shrink-0">
                              {formatListTime(c.lastMessageAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-tx-tertiary truncate">
                              {c.lastPreview || "暂无消息"}
                            </span>
                            {c.unreadCount > 0 && (
                              <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-accent-danger text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                {c.unreadCount > 99 ? "99+" : c.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      {c.type === "dm" && (
                        <button
                          type="button"
                          className="shrink-0 min-h-11 min-w-11 flex items-center justify-center text-tx-quaternary hover:text-accent-danger mr-1"
                          aria-label="删除对话"
                          onClick={(e) => void deleteConversation(c, e)}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {listQuery.trim() && listHits.length > 0 && (
                <div className="pb-3">
                  <div className="px-4 py-1.5 text-[11px] font-medium text-tx-tertiary">消息</div>
                  <ul>
                    {listHits.map((hit) => (
                      <li key={`${hit.conversationId}-${hit.message.id}`}>
                        <button
                          type="button"
                          className="w-full text-left px-4 py-2.5 min-h-12 hover:bg-app-hover"
                          onClick={() => jumpToMessage(hit.conversationId, hit.message.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-tx-primary truncate">
                              {hit.conversationTitle}
                            </span>
                            <span className="ml-auto text-[11px] text-tx-quaternary shrink-0">
                              {formatListTime(hit.message.createdAt)}
                            </span>
                          </div>
                          <div className="text-xs text-tx-tertiary truncate mt-0.5">
                            {hit.message.senderName ? `${hit.message.senderName}：` : ""}
                            {hit.snippet || imPreview(hit.message)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              </>
            )}
          </div>
        </section>
      )}

      {isDesktop && !activeId && (
        <div className="flex-1 hidden md:flex">
          <EmptyState
            icon={MessageCircle}
            title="选择一个会话"
            description="家庭群置顶，也可以点右上角和家人私聊。"
          />
        </div>
      )}

      {showThread && activeId && (
        <section
          className="flex-1 flex flex-col min-h-0 min-w-0 bg-app-bg"
          style={kbHeight > 0 ? { paddingBottom: kbHeight } : undefined}
        >
          <MobileChromeHeader
            variant="stack"
            stackAction={selecting ? "close" : "back"}
            title={
              selecting
                ? `已选 ${selectedIds.size} 条`
                : active?.title || "聊天"
            }
            onLeadingClick={selecting ? exitSelect : closeConversation}
            right={
              selecting ? (
                <MobileChromeIconButton
                  title="删除所选"
                  onClick={() => void deleteSelectedMessages()}
                >
                  <Trash2 size={18} />
                </MobileChromeIconButton>
              ) : (
                <div className="flex items-center">
                  <MobileChromeIconButton
                    title="搜索消息"
                    active={threadSearchOpen}
                    onClick={() => setThreadSearchOpen((v) => !v)}
                  >
                    <Search size={18} />
                  </MobileChromeIconButton>
                  <MobileChromeIconButton title="选择消息" onClick={() => setSelecting(true)}>
                    <Check size={18} />
                  </MobileChromeIconButton>
                  {(active?.type === "dm" || canModerate) && (
                    <MobileChromeIconButton title="清空聊天" onClick={() => void clearConversation()}>
                      <Trash2 size={18} />
                    </MobileChromeIconButton>
                  )}
                </div>
              )
            }
          />
          <PageHeader
            mdOnly
            title={selecting ? `已选 ${selectedIds.size} 条` : active?.title || "聊天"}
            actions={
              selecting ? (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={exitSelect}>
                    取消
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selectedIds.size === 0}
                    onClick={() => void deleteSelectedMessages()}
                  >
                    删除
                  </Button>
                </div>
              ) : (
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-label="搜索消息"
                    onClick={() => setThreadSearchOpen((v) => !v)}
                  >
                    <Search size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-label="选择消息"
                    onClick={() => setSelecting(true)}
                  >
                    <Check size={18} />
                  </Button>
                  {(active?.type === "dm" || canModerate) && (
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label="清空聊天"
                      onClick={() => void clearConversation()}
                    >
                      <Trash2 size={18} />
                    </Button>
                  )}
                </div>
              )
            }
          />

          {threadSearchOpen && (
            <div className="shrink-0 border-b border-app-border px-3 py-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-quaternary" />
                <input
                  autoFocus
                  value={threadQuery}
                  onChange={(e) => setThreadQuery(e.target.value)}
                  placeholder="搜索此会话的消息"
                  className={cn(fieldControlClass, "pl-8 pr-8")}
                />
                {threadQuery && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 flex items-center justify-center text-tx-quaternary"
                    aria-label="清除"
                    onClick={() => setThreadQuery("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {threadQuery.trim() && (
                <div className="max-h-48 overflow-y-auto mt-1 rounded-card border border-app-border bg-app-elevated">
                  {searchingThread ? (
                    <LoadingBlock label="搜索中…" size="sm" />
                  ) : threadHits.length === 0 ? (
                    <p className="text-xs text-tx-tertiary text-center py-4">没有匹配的消息</p>
                  ) : (
                    <ul>
                      {threadHits.map((hit) => (
                        <li key={hit.message.id}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 min-h-11 hover:bg-app-hover"
                            onClick={() => jumpToMessage(hit.conversationId, hit.message.id)}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-tx-primary truncate">
                                {hit.message.senderName || "消息"}
                              </span>
                              <span className="ml-auto text-[10px] text-tx-quaternary">
                                {formatListTime(hit.message.createdAt)}
                              </span>
                            </div>
                            <div className="text-xs text-tx-tertiary truncate mt-0.5">
                              {hit.snippet || imPreview(hit.message)}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="relative flex-1 min-h-0">
          <div
            ref={scrollerRef}
            className="h-full overflow-y-auto px-3 md:px-6 py-3"
            onScroll={(e) => {
              const el = e.currentTarget;
              const gapBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              stickBottomRef.current = gapBottom < 80 && !hasMoreAfter;
              if (el.scrollTop < 64 && hasMoreBefore && !loadingBefore && !msgLoading) {
                void loadOlder(activeId);
              }
              if (gapBottom < 64 && hasMoreAfter && !loadingAfter && !msgLoading) {
                void loadNewer(activeId);
              }
            }}
          >
            {loadingBefore && (
              <div className="py-2">
                <LoadingBlock label="更早的消息…" size="sm" />
              </div>
            )}
            {msgLoading && messages.length === 0 ? (
              <LoadingBlock label="加载消息…" />
            ) : messages.length === 0 ? (
              <EmptyState icon={MessageCircle} title="打个招呼吧" description="发文字、图片或文件。" />
            ) : (
              grouped.map((g) => (
                <div key={g.day} className="mb-3">
                  <div className="sticky top-0 z-sticky flex justify-center py-2">
                    <span className="text-[11px] text-tx-quaternary bg-app-bg/80 px-2 py-0.5 rounded-full">
                      {g.day}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {g.items.map((m) => {
                      const mine = m.senderId === me;
                      const selected = selectedIds.has(m.id);
                      const tint = bubbleStyle(m.senderId, mine);
                      const clearPress = () => {
                        if (pressTimerRef.current) {
                          window.clearTimeout(pressTimerRef.current);
                          pressTimerRef.current = null;
                        }
                      };
                      return (
                        <div
                          key={m.id}
                          data-msg-id={m.id}
                          className={cn(
                            "flex gap-2 items-end select-none",
                            mine ? "justify-end" : "justify-start",
                            selecting && "cursor-pointer",
                          )}
                          onClick={() => {
                            if (skipClickRef.current) {
                              skipClickRef.current = false;
                              return;
                            }
                            if (selecting) toggleSelected(m.id);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (selecting) {
                              toggleSelected(m.id);
                              return;
                            }
                            if (Date.now() - suppressContextMenuRef.current < 800) return;
                            if (isDesktop) openMenu(e, m.id, "message");
                            else setActionMsgId(m.id);
                          }}
                          onPointerDown={() => {
                            if (selecting || isDesktop) return;
                            clearPress();
                            longPressArmedRef.current = false;
                            pressTimerRef.current = window.setTimeout(() => {
                              longPressArmedRef.current = true;
                              haptic.medium();
                            }, 450);
                          }}
                          onPointerUp={() => {
                            const armed = longPressArmedRef.current;
                            longPressArmedRef.current = false;
                            clearPress();
                            if (!armed || selecting) return;
                            skipClickRef.current = true;
                            suppressContextMenuRef.current = Date.now();
                            setActionMsgId(m.id);
                          }}
                          onPointerCancel={() => {
                            longPressArmedRef.current = false;
                            clearPress();
                          }}
                          onPointerLeave={() => {
                            longPressArmedRef.current = false;
                            clearPress();
                          }}
                        >
                          {selecting && (
                            <span
                              className={cn(
                                "shrink-0 w-5 h-5 mb-4 rounded-full border flex items-center justify-center",
                                selected
                                  ? "bg-accent-primary border-accent-primary text-tx-inverse"
                                  : "border-app-border bg-app-surface",
                              )}
                              aria-hidden
                            >
                              {selected ? <Check size={12} /> : null}
                            </span>
                          )}
                          {!mine && (
                            <Avatar name={m.senderName || ""} url={m.senderAvatarUrl} size={28} />
                          )}
                          <div
                            className={cn("max-w-[78%] md:max-w-[64%] min-w-0 flex flex-col", mine && "items-end")}
                            onClickCapture={(e) => {
                              if (!skipClickRef.current) return;
                              skipClickRef.current = false;
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            {!mine && active?.type === "group" && (
                              <div className="text-[11px] text-tx-tertiary mb-0.5 px-1">
                                {m.senderName}
                              </div>
                            )}
                            {isStickerMessage(m) ? (
                              <img
                                src={stickerSrc(m)}
                                alt="表情"
                                className={cn(
                                  "block max-w-[120px] max-h-[120px] w-auto h-auto object-contain bg-transparent border-0 shadow-none",
                                  highlightId === m.id && "ring-2 ring-accent-primary rounded-button",
                                  selected && "ring-2 ring-accent-primary/50 rounded-button",
                                )}
                                draggable={false}
                              />
                            ) : m.type === "card" ? (
                              <div
                                className={cn(
                                  highlightId === m.id && "ring-2 ring-accent-primary rounded-card",
                                  selected && "ring-2 ring-accent-primary/50 rounded-card",
                                )}
                              >
                                <ImShareCardBubble body={m.body} disabled={selecting} />
                              </div>
                            ) : m.type === "image" && m.file ? (
                              <button
                                type="button"
                                className={cn(
                                  "block overflow-hidden rounded-button bg-transparent p-0 border-0 shadow-none",
                                  highlightId === m.id && "ring-2 ring-accent-primary",
                                  selected && "ring-2 ring-accent-primary/50",
                                )}
                                onClick={(e) => {
                                  if (selecting) {
                                    e.preventDefault();
                                    return;
                                  }
                                  setPreviewSrc(resolveAttachmentUrl(m.file!.url));
                                }}
                              >
                                <img
                                  src={resolveAttachmentUrl(`${m.file.url}?w=480`)}
                                  alt={m.file.filename}
                                  className="max-w-full max-h-64 object-contain bg-transparent"
                                />
                              </button>
                            ) : (
                            <div
                              style={tint}
                              className={cn(
                                "rounded-card text-sm leading-relaxed break-words border text-tx-primary",
                                m.type === "voice" ? "px-2 py-1" : "px-3 py-2",
                                selected && "ring-2 ring-accent-primary/50",
                                highlightId === m.id && "ring-2 ring-accent-primary",
                              )}
                            >
                              {m.type === "voice" && m.file ? (
                                <VoiceBubble
                                  src={resolveAttachmentUrl(m.file.url)}
                                  duration={parseInt(m.body, 10) || 1}
                                />
                              ) : m.type === "file" && m.file ? (
                                <a
                                  href={resolveAttachmentUrl(m.file.url)}
                                  download={m.file.filename}
                                  onClick={(e) => {
                                    if (selecting) e.preventDefault();
                                  }}
                                  className="flex items-center gap-2 min-h-11 text-tx-primary"
                                >
                                  <FileText size={18} className="shrink-0" />
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium">{m.file.filename}</span>
                                    <span className="text-[11px] text-tx-tertiary">
                                      {formatSize(m.file.size)}
                                    </span>
                                  </span>
                                  <Download size={16} className="shrink-0 ml-auto" />
                                </a>
                              ) : (
                                <MessageBody text={m.body} query={threadQuery.trim() || listQuery.trim() || undefined} />
                              )}
                            </div>
                            )}
                            <div
                              className={cn(
                                "text-[10px] text-tx-quaternary mt-0.5 px-1",
                                mine ? "text-right" : "text-left",
                              )}
                            >
                              {formatClock(m.createdAt)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            {loadingAfter && (
              <div className="py-2">
                <LoadingBlock label="更新的消息…" size="sm" />
              </div>
            )}
          </div>
          {hasMoreAfter && activeId && (
            <button
              type="button"
              className="absolute bottom-3 right-3 min-h-11 px-3 rounded-button bg-app-elevated border border-app-border shadow-sm text-xs font-medium text-tx-primary flex items-center gap-1"
              onClick={() => {
                stickBottomRef.current = true;
                void loadLatest(activeId);
              }}
            >
              <ChevronDown size={14} />
              回到最新
            </button>
          )}
          </div>

          <div
            className={cn(
              "relative shrink-0 border-t border-app-border bg-app-bg px-3 md:px-4 py-2",
              kbHeight > 0 ? "pb-2" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
            )}
          >
            <input
              ref={stickerInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const s = await api.im.uploadSticker(f);
                  setStickers((prev) => [s, ...prev]);
                  toast.success("已添加到我的表情");
                } catch (err: any) {
                  toast.error(err?.message || "添加失败");
                }
              }}
            />
            {mentionTrigger && active?.type === "group" && !emojiOpen && (
              <div className="mb-1">
                <MentionPicker
                  className="!relative"
                  search={mentionTrigger.search}
                  candidates={mentionCandidates}
                  onSelect={(user) => {
                    const next = replaceMentionText(
                      draft,
                      cursorPos,
                      mentionTrigger.startIndex,
                      user.username,
                    );
                    setDraft(next);
                    const pos = mentionTrigger.startIndex + user.username.length + 2;
                    setCursorPos(pos);
                    requestAnimationFrame(() => {
                      const el = textareaRef.current;
                      if (!el) return;
                      el.focus();
                      el.setSelectionRange(pos, pos);
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                    });
                  }}
                  onClose={() => setMentionClosed(true)}
                />
              </div>
            )}
            {recording ? (
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" size="icon-lg" className="!rounded-full shrink-0" aria-label="取消录音" onClick={cancelRecording}>
                  <X size={18} />
                </Button>
                <div
                  className={cn(
                    fieldControlClass,
                    "flex-1 min-w-0 w-0 flex items-center gap-2.5 min-h-11 py-0 overflow-hidden",
                  )}
                >
                  <span className="tabular-nums text-sm font-semibold text-accent-danger shrink-0 w-10">
                    {formatVoiceClock(recordDuration)}
                  </span>
                  <div className="flex-1 min-w-0 overflow-hidden flex items-end gap-px h-5 self-center" aria-hidden>
                    {recordWave.map((v, i) => (
                      <span
                        key={i}
                        className="block flex-1 min-w-0 max-w-[3px] rounded-full bg-accent-primary origin-bottom"
                        style={{ height: `${Math.round(10 + v * 90)}%` }}
                      />
                    ))}
                  </div>
                </div>
                <Button type="button" size="icon-lg" className="!rounded-full shrink-0" aria-label="发送语音" onClick={() => void finishRecording()}>
                  <Send size={18} />
                </Button>
              </div>
            ) : (
            <div className="flex items-end gap-1">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendFile(f, true);
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void sendFile(f, false);
                }}
              />
              {isDesktop ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="shrink-0"
                    aria-label="表情"
                    disabled={sending}
                    onClick={() => {
                      setPlusOpen(false);
                      setEmojiOpen((v) => !v);
                      setMentionClosed(true);
                    }}
                  >
                    <Smile size={18} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="shrink-0"
                    aria-label="发送图片"
                    disabled={sending}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <ImageIcon size={18} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="shrink-0"
                    aria-label="发送文件"
                    disabled={sending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={18} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="shrink-0"
                    aria-label="分享笔记、说说或任务"
                    disabled={sending}
                    onClick={() => {
                      setEmojiOpen(false);
                      setPlusOpen(false);
                      setSharePickerOpen(true);
                    }}
                  >
                    <Share2 size={18} />
                  </Button>
                  {active?.type === "group" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      className="shrink-0"
                      aria-label="提及成员"
                      disabled={sending}
                      onClick={insertAtMention}
                    >
                      <AtSign size={18} />
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="!rounded-full shrink-0"
                  aria-label="语音消息"
                  disabled={sending}
                  onClick={() => void startRecording()}
                >
                  <Mic size={22} />
                </Button>
              )}
              <textarea
                ref={textareaRef}
                value={draft}
                rows={1}
                placeholder={
                  isDesktop && active?.type === "group" ? "发消息，输入 @ 提及家人" : "发消息"
                }
                disabled={sending}
                className={cn(
                  fieldControlClass,
                  "flex-1 min-w-0 w-0 min-h-11 max-h-32 resize-none py-2.5 leading-5",
                  !isDesktop && "!rounded-full px-3.5",
                )}
                enterKeyHint="send"
                onFocus={() => {
                  setPlusOpen(false);
                  if (!isDesktop) setEmojiOpen(false);
                }}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setMentionClosed(false);
                  setCursorPos(e.target.selectionStart);
                  const el = e.target;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                }}
                onSelect={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                onKeyUp={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                onClick={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart)}
                onKeyDown={(e) => {
                  if (mentionTrigger) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendText();
                  }
                }}
              />
              {isDesktop ? (
                draft.trim() ? (
                  <Button
                    type="button"
                    size="icon-lg"
                    className="shrink-0"
                    aria-label="发送"
                    disabled={sending}
                    onClick={() => void sendText()}
                  >
                    <Send size={18} />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon-lg"
                    className="shrink-0"
                    aria-label="语音消息"
                    disabled={sending}
                    onClick={() => void startRecording()}
                  >
                    <Mic size={18} />
                  </Button>
                )
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="!rounded-full shrink-0"
                    aria-label="表情"
                    disabled={sending}
                    onClick={() => {
                      const next = !emojiOpen;
                      setEmojiOpen(next);
                      setPlusOpen(false);
                      setMentionClosed(true);
                      if (next) textareaRef.current?.blur();
                    }}
                  >
                    <Smile size={22} />
                  </Button>
                  {draft.trim() ? (
                    <Button
                      type="button"
                      size="icon-lg"
                      className="!rounded-full shrink-0"
                      aria-label="发送"
                      disabled={sending}
                      onClick={() => void sendText()}
                    >
                      <Send size={18} />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      className="!rounded-full shrink-0"
                      aria-label={plusOpen ? "收起" : "更多"}
                      disabled={sending}
                      onClick={() => {
                        setEmojiOpen(false);
                        setPlusOpen((v) => {
                          const next = !v;
                          if (next) textareaRef.current?.blur();
                          return next;
                        });
                      }}
                    >
                      <Plus
                        size={22}
                        className={cn(
                          "transition-transform duration-fast ease-out",
                          plusOpen && "rotate-45",
                        )}
                      />
                    </Button>
                  )}
                </>
              )}
            </div>
            )}
            {emojiOpen && (
              <div className="pt-2">
                <EmojiPicker
                  className="w-full max-w-full shadow-xs"
                  initialTab="mine"
                  onSelectTextEmoji={(emoji) => {
                    const el = textareaRef.current;
                    const pos = el?.selectionStart ?? draft.length;
                    const next = draft.slice(0, pos) + emoji + draft.slice(pos);
                    setDraft(next);
                    const caret = pos + emoji.length;
                    setCursorPos(caret);
                    requestAnimationFrame(() => {
                      if (!el) return;
                      if (isDesktop) {
                        el.focus();
                        el.setSelectionRange(caret, caret);
                      }
                    });
                  }}
                  onSelectImageEmoji={(url) => void sendSticker(url)}
                  customStickers={stickers.map((s) => ({
                    id: s.id,
                    url: resolveAttachmentUrl(s.url),
                  }))}
                  onSelectCustom={(s) => void sendSticker(`sticker:${s.id}`)}
                  onAddCustom={() => stickerInputRef.current?.click()}
                  onDeleteCustom={async (id) => {
                    try {
                      await api.im.deleteSticker(id);
                      setStickers((prev) => prev.filter((s) => s.id !== id));
                      toast.success("已删除");
                    } catch (err: any) {
                      toast.error(err?.message || "删除失败");
                    }
                  }}
                />
              </div>
            )}
            {plusOpen && !isDesktop && !recording && !emojiOpen && (
              <div className="grid grid-cols-4 gap-x-2 gap-y-3 px-1 pt-3">
                <ComposerMoreTile
                  icon={ImageIcon}
                  label="图片"
                  disabled={sending}
                  onClick={() => {
                    setPlusOpen(false);
                    imageInputRef.current?.click();
                  }}
                />
                <ComposerMoreTile
                  icon={Paperclip}
                  label="文件"
                  disabled={sending}
                  onClick={() => {
                    setPlusOpen(false);
                    fileInputRef.current?.click();
                  }}
                />
                <ComposerMoreTile
                  icon={Share2}
                  label="分享"
                  disabled={sending}
                  onClick={() => {
                    setPlusOpen(false);
                    setSharePickerOpen(true);
                  }}
                />
                {active?.type === "group" && (
                  <ComposerMoreTile
                    icon={AtSign}
                    label="提及"
                    disabled={sending}
                    onClick={insertAtMention}
                  />
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <ContextMenu
        isOpen={menu.isOpen && menu.targetType === "message"}
        x={menu.x}
        y={menu.y}
        menuRef={menuRef}
        items={
          menu.targetId
            ? (() => {
                const target = messages.find((x) => x.id === menu.targetId);
                return target ? messageMenuItems(target) : [];
              })()
            : []
        }
        onAction={(id) => {
          const target = messages.find((x) => x.id === menu.targetId);
          if (target) void handleMessageAction(id, target);
          else closeMenu();
        }}
      />

      <BottomSheet
        open={Boolean(actionMsg)}
        onClose={() => setActionMsgId(null)}
        title="消息操作"
      >
        {actionMsg ? (
          <div className="py-1">
            <MessageActionRow
              icon={Copy}
              label="复制"
              onClick={() => void handleMessageAction("copy", actionMsg)}
            />
            <MessageActionRow
              icon={ListTodo}
              label="添加到任务"
              onClick={() => void handleMessageAction("to-task", actionMsg)}
            />
            <MessageActionRow
              icon={BookOpen}
              label="添加到说说"
              disabled={isStickerMessage(actionMsg)}
              onClick={() => void handleMessageAction("to-diary", actionMsg)}
            />
            <div className="h-px bg-app-border my-1 mx-2" />
            <MessageActionRow
              icon={Trash2}
              label="删除"
              danger
              disabled={!canDeleteMessage(actionMsg)}
              onClick={() => void handleMessageAction("delete", actionMsg)}
            />
          </div>
        ) : null}
      </BottomSheet>

      {activeId && (
        <ShareItemPickerSheet
          open={sharePickerOpen}
          onClose={() => setSharePickerOpen(false)}
          conversationId={activeId}
          onSent={(sent) => void appendSent(sent)}
        />
      )}

      <BottomSheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="发起私聊">
        {members.length === 0 ? (
          <p className="text-sm text-tx-tertiary px-1 py-6 text-center">工作区里还没有其他成员</p>
        ) : (
          <ul className="py-1">
            {members.map((m) => {
              const name = m.displayName || m.username;
              return (
                <li key={m.userId}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 min-h-12 px-2 rounded-button hover:bg-app-hover text-left"
                    onClick={() => void startDm(m.userId)}
                  >
                    <Avatar name={name} url={m.avatarUrl} />
                    <span className="text-sm text-tx-primary">{name}</span>
                    <span className="text-xs text-tx-tertiary ml-auto">@{m.username}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </BottomSheet>

      {previewSrc && (
        <Motion.div
          className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setPreviewSrc(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 min-h-11 min-w-11 flex items-center justify-center text-white"
            aria-label="关闭"
            onClick={() => setPreviewSrc(null)}
          >
            <X size={22} />
          </button>
          <img
            src={previewSrc}
            alt=""
            className="max-w-full max-h-full object-contain rounded-card"
            onClick={(e) => e.stopPropagation()}
          />
        </Motion.div>
      )}
    </div>
  );
}
