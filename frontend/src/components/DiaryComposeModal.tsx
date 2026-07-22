import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { EmojiPicker } from "./EmojiPicker";
import { ChevronDown, Smile, Tag as TagIcon, Globe, Lock, Mic, Play, Pause, Trash2, X, Send, Loader2, Camera, Check, Undo, Image as ImageIcon, Video, AtSign, MoreHorizontal, ScanText, RotateCcw, Sparkles } from "lucide-react";
import { api, getCurrentWorkspace } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useApp, useAppActions } from "@/store/AppContext";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { motion, AnimatePresence } from "framer-motion";
import ComposerCameraModal from "@/components/ComposerCameraModal";
import MobileCameraModal from "@/components/MobileCameraModal";
import OCRModal from "@/components/OCRModal";
import { registerPlugin } from "@capacitor/core";
import { haptic } from "@/hooks/useCapacitor";
import { WorkspaceMember } from "@/types";
import RecordingPanel from "@/components/RecordingPanel";
import TextareaFormatToolbar from "@/components/common/TextareaFormatToolbar";
import { useModalFocusTrap } from "@/hooks/useModalFocusTrap";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";


interface DiaryComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPost: () => void;
  initialImages?: { id: string; url: string }[];
}

export default function DiaryComposeModal({ isOpen, onClose, onPost, initialImages = [] }: DiaryComposeModalProps) {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
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

  const [showMemberSelector, setShowMemberSelector] = useState(false);
  const [showMoreOptionsSheet, setShowMoreOptionsSheet] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<"top" | "bottom">("top");

  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const mediaMenuRef = useRef<HTMLDivElement>(null);
  const [formatting, setFormatting] = useState(false);
  const [originalTextBeforeAI, setOriginalTextBeforeAI] = useState("");
  const [showUndoButton, setShowUndoButton] = useState(false);


  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [me, setMe] = useState<any>(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (mediaMenuRef.current && !mediaMenuRef.current.contains(target)) {
        setIsMediaMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  useEffect(() => {

    if (!showMemberSelector) return;

    const loadData = async () => {
      setLoadingMembers(true);
      try {
        const currentUser = await api.getMe();
        setMe(currentUser);

        const ws = getCurrentWorkspace();
        console.log("[DiaryComposeModal] ws:", ws);
        if (ws && ws !== "personal") {
          const allMembers = await api.getWorkspaceMembers(ws);
          console.log("[DiaryComposeModal] allMembers:", allMembers);
          setMembers(allMembers);
        } else {
          setMembers([]);
        }
      } catch (err) {
        console.error("Failed to load workspace members:", err);
      } finally {
        setLoadingMembers(false);
      }
    };

    loadData();
  }, [showMemberSelector]);

  const commonChineseInitials: Record<string, string> = {
    '张': 'Z', '李': 'L', '王': 'W', '刘': 'L', '陈': 'C', '杨': 'Y', '黄': 'H', '赵': 'Z', '周': 'Z', '吴': 'W',
    '徐': 'X', '孙': 'S', '胡': 'H', '朱': 'Z', '高': 'G', '林': 'L', '何': 'H', '郭': 'G', '马': 'M', '罗': 'L',
    '梁': 'L', '宋': 'S', '郑': 'Z', '谢': 'X', '韩': 'H', '唐': 'T', '冯': 'F', '于': 'Y', '董': 'D', '萧': 'X',
    '程': 'C', '曹': 'C', '袁': 'Y', '邓': 'D', '许': 'X', '傅': 'F', '沈': 'S', '曾': 'Z', '彭': 'P', '吕': 'L',
    '苏': 'S', '卢': 'L', '蒋': 'J', '蔡': 'C', '贾': 'J', '丁': 'D', '魏': 'W', '薛': 'X', '叶': 'Y', '阎': 'Y',
    '余': 'Y', '潘': 'P', '杜': 'D', '戴': 'D', '夏': 'X', '钟': 'Z', '汪': 'W', '田': 'T', '任': 'R', '强': 'Q',
    '范': 'F', '方': 'F', '石': 'S', '姚': 'Y', '谭': 'T', '廖': 'L', '邹': 'Z', '熊': 'X', '金': 'J', '陆': 'L',
    '郝': 'H', '孔': 'K', '白': 'B', '崔': 'C', '康': 'K', '毛': 'M', '邱': 'Q', '秦': 'P', '江': 'J', '史': 'S',
    '顾': 'G', '侯': 'H', '邵': 'S', '孟': 'M', '龙': 'L', '万': 'W', '段': 'D', '雷': 'R', '钱': 'Q', '汤': 'T',
    '尹': 'Y', '黎': 'L', '易': 'Y', '常': 'C', '武': 'W', '乔': 'Q', '贺': 'H', '赖': 'L', '龚': 'G', '文': 'W'
  };

  const getMemberInitial = (username: string): string => {
    if (!username) return "#";
    const char = username.trim().charAt(0);
    if (/^[a-zA-Z]$/.test(char)) return char.toUpperCase();

    const code = char.charCodeAt(0);
    if (code >= 0x4e00 && code <= 0x9fa5) {
      const initial = commonChineseInitials[char];
      if (initial) return initial;
    }
    return "#";
  };

  const memberDisplayName = (m: WorkspaceMember) =>
    (m.displayName && m.displayName.trim()) || m.username;

  const filteredMembers = members.filter((m) =>
    m.userId !== me?.id && (
      m.username.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
      (m.displayName && m.displayName.toLowerCase().includes(memberSearchQuery.toLowerCase())) ||
      (m.email && m.email.toLowerCase().includes(memberSearchQuery.toLowerCase()))
    )
  );

  const groupedMembers = useMemo(() => {
    const groups: Record<string, WorkspaceMember[]> = {};
    for (let i = 65; i <= 90; i++) {
      groups[String.fromCharCode(i)] = [];
    }
    groups["#"] = [];

    filteredMembers.forEach((m) => {
      const initial = getMemberInitial(memberDisplayName(m));
      if (groups[initial]) {
        groups[initial].push(m);
      } else {
        groups["#"].push(m);
      }
    });

    return Object.keys(groups)
      .sort((a, b) => {
        if (a === "#") return 1;
        if (b === "#") return -1;
        return a.localeCompare(b);
      })
      .reduce<Record<string, WorkspaceMember[]>>((acc, key) => {
        if (groups[key].length > 0) {
          acc[key] = groups[key];
        }
        return acc;
      }, {});
  }, [filteredMembers]);

  const handleConfirmMembers = () => {
    const el = textareaRef.current;
    if (!el) return;

    const selectedNames = members
      .filter((m) => selectedMemberIds.includes(m.userId))
      .map((m) => `@${m.username} `)
      .join("");

    if (selectedNames) {
      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const nextText = text.slice(0, start) + selectedNames + text.slice(end);
      setText(nextText);

      setTimeout(() => {
        el.focus();
        const nextPos = start + selectedNames.length;
        el.setSelectionRange(nextPos, nextPos);
      }, 50);
    }

    setShowMemberSelector(false);
    setSelectedMemberIds([]);
    setMemberSearchQuery("");
  };

  const scrollToSection = (letter: string) => {
    const element = document.getElementById(`member-section-${letter}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleAddTag = useCallback(async (tagName: string) => {
    haptic.light();
    const existing = state.tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
    if (existing) {
      if (selectedTags.some((t) => t.id === existing.id)) {
        setSelectedTags((prev) => prev.filter((t) => t.id !== existing.id));
      } else {
        setSelectedTags((prev) => [...prev, existing]);
      }
    } else {
      try {
        const newTag = await api.createTag({ name: tagName });
        setSelectedTags((prev) => [...prev, newTag]);
        const allTags = await api.getTags();
        actions.setTags(allTags);
      } catch (err) {
        console.error("Failed to create tag:", err);
      }
    }
  }, [state.tags, selectedTags, actions]);

  // Mobile viewport stickiness
  const isMobile = window.innerWidth < 768;
  const [showCamera, setShowCamera] = useState(false);
  const [showOCRModal, setShowOCRModal] = useState(false);
  const [showPhotoCamera, setShowPhotoCamera] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [tempAudioBlob, setTempAudioBlob] = useState<Blob | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number } | null>(null);

  // Images Grid (说说支持拍照上传图片，支持图片九宫格展示)
  const [images, setImages] = useState<{ id: string; url: string; isVideo?: boolean }[]>(initialImages);

  useEffect(() => {
    if (initialImages && initialImages.length > 0) {
      setImages(initialImages);
    }
  }, [initialImages]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Audio Recording States
  const [recording, setRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [waveValues, setWaveValues] = useState<number[]>(new Array(25).fill(0.05));
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

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
      // 延迟聚焦 + preventScroll：避免与弹层挂载 / 键盘 inset 写入叠在一起抖动
      const delay = isMobile ? 320 : 80;
      const t = window.setTimeout(() => {
        textareaRef.current?.focus({ preventScroll: true });
      }, delay);
      return () => window.clearTimeout(t);
    } else {
      setSelectionMode(false);
      setMenuCoords(null);
      setHistory([]);
    }
  }, [isOpen, isMobile]);

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
    if (recording && !isPaused) {
      recordTimerRef.current = setInterval(() => {
        setRecordDuration((d) => d + 1);
      }, 1000);
    } else {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    }
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, [recording, isPaused]);

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
        haptic.medium();
      }
      setRecording(false);
    } else {
      // Start recording
      try {
        // On Android: request native mic permission through plugin first.
        // Plugin now returns consistent { granted: bool }.
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
          if (animationFrameIdRef.current) {
            cancelAnimationFrame(animationFrameIdRef.current);
            animationFrameIdRef.current = null;
          }
          if (audioContextRef.current && audioContextRef.current.state !== "closed") {
            audioContextRef.current.close().catch(() => {});
            audioContextRef.current = null;
          }
          
          if (audioChunksRef.current.length === 0) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

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

        // Web Audio Analyser for real-time waveform visualization
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyserRef.current = analyser;
          source.connect(analyser);

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          dataArrayRef.current = dataArray;

          const updateWave = () => {
            analyser.getByteFrequencyData(dataArray);
            const nextValues: number[] = [];
            for (let i = 0; i < 25; i++) {
              const val = dataArray[i] || 0;
              nextValues.push(Math.max(0.05, val / 255));
            }
            setWaveValues(nextValues);
            animationFrameIdRef.current = requestAnimationFrame(updateWave);
          };
          animationFrameIdRef.current = requestAnimationFrame(updateWave);
        } catch (ae) {
          console.error("Failed to initialize audio analyser:", ae);
        }

        mediaRecorder.start(200);
        haptic.light();
        setRecording(true);
      } catch (err) {
        console.error("Failed to start recording:", err);
        toast.error("无法访问录音设备，请检查麦克风权限");
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

  // ----------------- Mobile Recording & Camera -----------------
  const handleCameraComplete = async (files: File[]) => {
    setUploadingImage(true);
    try {
      for (const file of files) {
        const res = await api.diaryImages.upload(file);
        const isVideo = file.type.startsWith("video/");
        setImages((prev) => [
          ...prev,
          {
            id: res.id,
            url: api.diaryImages.urlFor(res.id),
            isVideo,
          },
        ]);
      }
      toast.success("媒体上传成功");
    } catch (err: any) {
      toast.error(err?.message || "媒体上传失败");
    } finally {
      setUploadingImage(false);
      setShowCamera(false);
    }
  };

  const handlePhotoCapture = async (file: File) => {
    setUploadingImage(true);
    try {
      const res = await api.diaryImages.upload(file);
      setImages((prev) => [
        ...prev,
        {
          id: res.id,
          url: api.diaryImages.urlFor(res.id),
          isVideo: false,
        },
      ]);
      toast.success("图片拍照上传成功");
    } catch (err: any) {
      toast.error(err?.message || "图片拍照上传失败");
    } finally {
      setUploadingImage(false);
      setShowPhotoCamera(false);
    }
  };



  const startRecordingProcess = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast.error("录音功能要求安全上下文 (HTTPS 或 localhost)，请通过 USB 隧道 (localhost) 访问以授权麦克风");
      setShowVoiceRecorder(false);
      return;
    }
    try {
      // On Android: request native mic permission through plugin first.
      // Plugin now returns consistent { granted: bool }.
      if (
        typeof window !== "undefined" &&
        (window as any).Capacitor?.getPlatform?.() === "android"
      ) {
        try {
          const AppPermissions = registerPlugin<any>("AppPermissions");
          const micRes = await AppPermissions.requestMicrophonePermission();
          if (!micRes.granted) {
            toast.error("需要麦克风权限才能使用录音功能，请在系统设置中授予权限");
            setShowVoiceRecorder(false);
            return;
          }
        } catch (permErr) {
          console.warn("Capacitor mic permission plugin unavailable:", permErr);
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (animationFrameIdRef.current) {
          cancelAnimationFrame(animationFrameIdRef.current);
          animationFrameIdRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setTempAudioBlob(audioBlob);
        stream!.getTracks().forEach((track) => track.stop());
      };

      // Web Audio Analyser for real-time waveform visualization
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyserRef.current = analyser;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        dataArrayRef.current = dataArray;

        const updateWave = () => {
          if (mediaRecorder.state === "paused") {
            setWaveValues(prev => prev.map(v => Math.max(0.05, v * 0.85)));
          } else {
            analyser.getByteFrequencyData(dataArray);
            const nextValues: number[] = [];
            for (let i = 0; i < 25; i++) {
              const val = dataArray[i] || 0;
              nextValues.push(Math.max(0.05, val / 255));
            }
            setWaveValues(nextValues);
          }
          animationFrameIdRef.current = requestAnimationFrame(updateWave);
        };
        animationFrameIdRef.current = requestAnimationFrame(updateWave);
      } catch (ae) {
        console.error("Failed to initialize audio analyser:", ae);
      }

      mediaRecorder.start(200);
      haptic.light();
      setRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
      toast.error("无法访问录音设备");
      setShowVoiceRecorder(false);
    }
  };

  useEffect(() => {
    if (showVoiceRecorder) {
      setRecordDuration(0);
      setIsPaused(false);
      startRecordingProcess();
    } else {
      setRecording(false);
      setIsPaused(false);
      setTempAudioBlob(null);
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    }
  }, [showVoiceRecorder]);

  const handleToggleVoiceRecord = () => {
    // Keep standard click toggle behavior on the central button
    if (recording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      haptic.medium();
      setRecording(false);
      setIsPaused(false);
    } else {
      haptic.light();
      setTempAudioBlob(null);
      setRecordDuration(0);
      setIsPaused(false);
      startRecordingProcess();
    }
  };

  const handleTogglePauseVoiceRecord = () => {
    if (!recording) return;
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      haptic.light();
      if (isPaused) {
        recorder.resume();
        setIsPaused(false);
      } else {
        recorder.pause();
        setIsPaused(true);
      }
    }
  };

  const handleCancelVoiceRecord = () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    setIsPaused(false);
    setTempAudioBlob(null);
    setShowVoiceRecorder(false);
  };

  const handleFinishVoiceRecord = async () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setVoiceUploading(true);
    setShowVoiceRecorder(false);
    setIsPaused(false);

    const uploadBlob = async (blob: Blob, duration: number) => {
      const file = new File([blob], `voice_${Date.now()}.webm`, { type: "audio/webm" });
      try {
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
    };

    if (recording) {
      if (mediaRecorderRef.current) {
        const currentDuration = recordDuration;
        mediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          await uploadBlob(audioBlob, currentDuration);
        };
        mediaRecorderRef.current.stop();
        haptic.medium();
        setRecording(false);
      } else {
        setVoiceUploading(false);
      }
    } else if (tempAudioBlob) {
      await uploadBlob(tempAudioBlob, recordDuration);
    } else {
      setVoiceUploading(false);
    }
  };

  const handleMicButtonClick = () => {
    if (isMobile) {
      setShowVoiceRecorder(true);
    } else {
      handleRecordClick();
    }
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

    const handleImageEmojiSelect = (url: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const markdownImg = `![emoji](${url})`;
    const nextText = text.slice(0, start) + markdownImg + text.slice(end);
    setText(nextText);

    // Position cursor after inserted emoji
    setTimeout(() => {
      el.focus();
      const pos = start + markdownImg.length;
      el.setSelectionRange(pos, pos);
    }, 50);
  };

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
    haptic.light();
    if (selectedTags.some((t) => t.id === tag.id)) {
      setSelectedTags((prev) => prev.filter((t) => t.id !== tag.id));
    } else {
      setSelectedTags((prev) => [...prev, tag]);
    }
  };

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


  // ----------------- Custom text selection controls -----------------
  const pushHistory = (currentText: string) => {
    setHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === currentText) return prev;
      const next = [...prev, currentText];
      if (next.length > 20) next.shift();
      return next;
    });
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prevText = history[history.length - 1];
    setHistory((prev) => prev.slice(0, prev.length - 1));
    setText(prevText);
    toast.success("已恢复上一步修改");
  };

  const handleClearAll = () => {
    if (!text.trim()) return;
    const confirmDelete = window.confirm("确定要清空编辑区域的所有内容吗？此操作可以使用恢复按钮撤销。");
    if (confirmDelete) {
      pushHistory(text);
      setText("");
      toast.success("内容已清空");
    }
  };

  const handleDeleteSelected = () => {
    const el = textareaRef.current;
    if (!el) return;
    pushHistory(text);
    const nextText = text.slice(0, selStart) + text.slice(selEnd);
    setText(nextText);
    setSelEnd(selStart);
    setSelectionMode(false);
    setMenuCoords(null);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(selStart, selStart);
    }, 50);
  };



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

      // Calculate selection coordinates for WeChat-style menu
      setTimeout(() => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect && rect.top > 0 && rect.left > 0) {
            const menuWidth = 240;
            const margin = 16;
            const left = Math.max(
              menuWidth / 2 + margin,
              Math.min(window.innerWidth - (menuWidth / 2 + margin), rect.left + rect.width / 2)
            );
            // Check if too close to the header (approx 120px to account for header + safe area)
            const tooCloseToTop = rect.top < 120;
            const placement = tooCloseToTop ? "bottom" : "top";
            setMenuPlacement(placement);

            setMenuCoords({
              top: placement === "top" ? rect.top - 8 : rect.bottom + 8,
              left: left
            });
          } else {
            // Fallback
            const textareaRect = el.getBoundingClientRect();
            setMenuPlacement("bottom");
            setMenuCoords({
              top: textareaRect.top + 20,
              left: window.innerWidth / 2
            });
          }
        }
      }, 50);
    } else {
      setSelectionMode(false);
      setMenuCoords(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = textareaRef.current;
    if (!el || text.length === 0) return;

    setSelectionMode(true);
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;

    if (start === end) {
      const left = Math.max(0, start - 2);
      const right = Math.min(text.length, start + 2);
      setSelStart(left);
      setSelEnd(right);
      el.setSelectionRange(left, right);
    } else {
      setSelStart(start);
      setSelEnd(end);
    }
    
    setTimeout(() => {
      handleTextareaSelectionChange();
    }, 50);
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
      pushHistory(text);
      const nextText = text.slice(0, selStart) + text.slice(selEnd);
      setText(nextText);
      setSelEnd(selStart);
      setSelectionMode(false);
      setMenuCoords(null);
      toast.success("已剪切");
    });
  };

  const handlePaste = () => {
    const el = textareaRef.current;
    if (!el) return;
    navigator.clipboard.readText().then((clipText) => {
      pushHistory(text);
      const nextText = text.slice(0, selStart) + clipText + text.slice(selEnd);
      setText(nextText);
      const nextPos = selStart + clipText.length;
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(nextPos, nextPos);
      }, 50);
      setSelectionMode(false);
      setMenuCoords(null);
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
      haptic.success();
      
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

  const trapRef = useModalFocusTrap(isOpen && !isMobile, onClose);
  const { visible: kbVisible } = useKeyboardVisible();

  if (!isOpen) return null;

  // 桌面 Web：居中大弹窗；移动：全屏 sheet（底边贴键盘，不改 height 避免闪烁）
  const shell = (
    <div
      ref={trapRef as React.RefObject<HTMLDivElement>}
      className={cn(
        "bg-app-bg flex flex-col overflow-hidden",
        isMobile
          ? "fixed z-[60] left-0 right-0 top-0"
          : "relative w-full max-w-2xl max-h-[min(88vh,820px)] rounded-2xl border border-app-border shadow-2xl shadow-black/20 dark:shadow-black/50",
      )}
      style={
        isMobile
          ? {
              // 用 bottom 贴键盘，避免 height 随 visualViewport 每帧变化导致整页闪
              bottom: "var(--keyboard-height, 0px)",
            }
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-label="新建说说"
    >
      {/* 顶栏 */}
      <header
        className={cn(
          "flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-surface shrink-0",
          !isMobile && "rounded-t-2xl",
        )}
        style={
          isMobile
            ? { paddingTop: "calc(var(--safe-area-top) + 8px)" }
            : undefined
        }
      >
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-tx-secondary hover:bg-app-hover active:scale-95"
          aria-label="关闭"
        >
          {isMobile ? <ChevronDown size={24} /> : <X size={20} />}
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
      <div
        className={cn(
          "flex-1 flex flex-col p-4 overflow-y-auto space-y-4 min-h-0",
          isMobile ? "pb-20" : "pb-4",
        )}
      >
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
          className="w-full flex-1 bg-transparent text-sm text-tx-primary placeholder:text-tx-tertiary border-none outline-none resize-none min-h-[150px] focus:ring-0 no-focus-ring"
        />

        {/* 常用标签推荐 */}
        <div className="flex flex-wrap items-center gap-1.5 px-1 py-1 shrink-0">
          <span className="text-[11px] text-tx-tertiary mr-1 font-medium">推荐标签:</span>
          {((state.tags && state.tags.length > 0) ? state.tags.slice(0, 5) : [
            { id: "1", name: "日记" },
            { id: "2", name: "想法" },
            { id: "3", name: "工作" },
            { id: "4", name: "学习" },
            { id: "5", name: "生活" }
          ]).map((tag) => {
            const isSelected = selectedTags.some((t) => t.name.toLowerCase() === tag.name.toLowerCase());
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleAddTag(tag.name)}
                className={cn(
                  "text-[11px] px-2.5 py-0.5 rounded-full transition-all border",
                  isSelected
                    ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary font-medium"
                    : "bg-app-hover border-transparent hover:bg-accent-primary/10 hover:text-accent-primary text-tx-secondary"
                )}
              >
                #{tag.name}
              </button>
            );
          })}
        </div>

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
        
        {images.filter((img) => !img.isVideo).length > 0 && (
          <div className={cn(
            "grid gap-2",
            images.filter((img) => !img.isVideo).length === 1 && "grid-cols-1",
            images.filter((img) => !img.isVideo).length === 2 && "grid-cols-2",
            images.filter((img) => !img.isVideo).length >= 3 && "grid-cols-3"
          )}>
            {images
              .filter((img) => !img.isVideo)
              .map((img) => (
                <div
                  key={img.id}
                  className={cn(
                    "relative overflow-hidden rounded-xl border border-app-border bg-app-hover/30 group",
                    images.filter((img) => !img.isVideo).length === 1 ? "max-h-[240px] aspect-[4/3]" : "aspect-square"
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
                <EmojiPicker
                  onSelectTextEmoji={handleEmojiSelect}
                  onSelectImageEmoji={handleImageEmojiSelect}
                  className="w-full h-64 border-none shadow-none bg-app-surface"
                />
              </div>
            </div>
          </motion.div>
        )}

        {showTags && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="bg-app-surface border-t border-app-border overflow-hidden shrink-0"
          >
            <div className="p-4 max-h-[250px] overflow-y-auto flex flex-col gap-3">
              {/* 新建/添加标签输入框 */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="添加或新建标签..."
                  className="flex-1 px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-xs text-tx-primary outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 no-focus-ring"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const name = e.currentTarget.value.trim();
                      if (!name) return;
                      // 检查是否已存在
                      const existing = state.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
                      if (existing) {
                        if (!selectedTags.some((t) => t.id === existing.id)) {
                          setSelectedTags((prev) => [...prev, existing]);
                        }
                      } else {
                        try {
                          const newTag = await api.createTag({ name });
                          setSelectedTags((prev) => [...prev, newTag]);
                          const allTags = await api.getTags();
                          actions.setTags(allTags);
                        } catch (err) {
                          console.error("Failed to create tag:", err);
                        }
                      }
                      e.currentTarget.value = "";
                    }
                  }}
                />
              </div>

              <h4 className="text-[10px] font-semibold text-tx-tertiary uppercase tracking-wider">选择说说标签</h4>
              {state.tags.length > 0 ? (
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
              ) : (
                <div className="text-xs text-tx-tertiary py-1">暂无标签，请输入并按回车创建新标签</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 视频缩略图预览条 (出现在下侧工具栏的上方) */}
      {images.some((img) => img.isVideo) && (
        <div className="px-4 py-2 border-t border-app-border bg-app-surface flex items-center gap-3 overflow-x-auto shrink-0">
          {images
            .filter((img) => img.isVideo)
            .map((img) => (
              <div key={img.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-app-border bg-black shrink-0">
                <video src={img.url} className="w-full h-full object-cover" muted playsInline />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <Play size={12} className="text-white" />
                </div>
                <button
                  onClick={() => handleRemoveImage(img.id)}
                  className="absolute top-0.5 right-0.5 w-[18px] h-[18px] rounded-full bg-black/60 hover:bg-red-500 text-white flex items-center justify-center active:scale-90"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
        </div>
      )}

      {/* 电脑端录音实时波形与控制面板 */}
      <AnimatePresence>
        {recording && !isMobile && (
          <RecordingPanel
            duration={recordDuration}
            waveformData={waveValues}
            onRecordingComplete={async () => {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
                haptic.medium();
              }
              setRecording(false);
            }}
            onCancel={() => {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
              }
              audioChunksRef.current = [];
              setRecording(false);
              setRecordDuration(0);
              if (animationFrameIdRef.current) {
                cancelAnimationFrame(animationFrameIdRef.current);
                animationFrameIdRef.current = null;
              }
              if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                audioContextRef.current.close().catch(() => {});
                audioContextRef.current = null;
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* 底部操作工具栏（移动：父层 bottom 已贴键盘；有键盘时不再叠 safe-area） */}
      <div
        className={cn(
          "p-3 bg-app-surface border-t border-app-border flex items-center justify-between shrink-0",
          !isMobile && "rounded-b-2xl",
        )}
        style={
          isMobile
            ? {
                paddingBottom: kbVisible
                  ? 8
                  : "calc(var(--safe-area-bottom, 0px) + 8px)",
              }
            : undefined
        }
      >
        {/* 左侧：可见性权限 + 清空与恢复 */}
        <div className="flex items-center gap-1">
          {getCurrentWorkspace() && getCurrentWorkspace() !== "personal" && (
            <button
              onClick={() => setVisibility((v) => (v === "PRIVATE" ? "PUBLIC" : "PRIVATE"))}
              className={cn(
                "flex items-center justify-center transition-all border border-app-border/60 bg-app-surface shrink-0",
                isMobile ? "w-10 h-10 rounded-xl" : "gap-1 px-2.5 py-1.5 rounded-full text-xs",
                visibility === "PUBLIC" ? "text-accent-primary border-accent-primary/20 bg-accent-primary/5" : "text-tx-secondary"
              )}
              title={visibility === "PUBLIC" ? "公开可见" : "私有"}
            >
              {visibility === "PUBLIC" ? (
                <>
                  <Globe size={isMobile ? 16 : 13} />
                  {!isMobile && <span>公开可见</span>}
                </>
              ) : (
                <>
                  <Lock size={isMobile ? 16 : 13} />
                  {!isMobile && <span>私有</span>}
                </>
              )}
            </button>
          )}

          {text.trim().length > 0 && (
            <button
              onClick={handleClearAll}
              className="p-2 text-tx-secondary hover:text-red-500 rounded-lg hover:bg-app-hover transition-colors shrink-0"
              title="清空内容"
            >
              <Trash2 size={16} />
            </button>
          )}

          {history.length > 0 && (
            <button
              onClick={handleUndo}
              className="p-2 text-tx-secondary hover:text-accent-primary rounded-lg hover:bg-app-hover transition-colors shrink-0"
              title="恢复上一步"
            >
              <Undo size={16} />
            </button>
          )}
        </div>

        {/* 右侧：标签、@、媒体、格式A、AI整理 */}
        <div className="flex items-center gap-1">
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

          {/* @ 提醒谁看 */}
          <button
            type="button"
            onClick={() => setShowMemberSelector(true)}
            className="p-2.5 rounded-xl text-tx-secondary hover:bg-app-hover"
            title="提醒谁看"
          >
            <AtSign size={18} />
          </button>

          {/* 媒体按钮及其浮层 */}
          <div className="relative" ref={mediaMenuRef}>
            <button
              type="button"
              onClick={() => {
                setIsMediaMenuOpen(!isMediaMenuOpen);
              }}
              className={cn(
                "flex items-center justify-center transition-colors font-medium border border-app-border bg-app-surface",
                isMobile ? "w-10 h-10 rounded-xl" : "gap-1.5 px-2.5 py-1.5 rounded-xl text-xs",
                isMediaMenuOpen ? "bg-accent-primary/15 text-accent-primary border-accent-primary/20" : "text-tx-secondary"
              )}
              title="媒体"
            >
              <ImageIcon size={isMobile ? 18 : 16} />
              {!isMobile && <span>媒体</span>}
            </button>
            <AnimatePresence>
              {isMediaMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-11 right-0 bg-app-elevated border border-app-border shadow-lg rounded-xl p-1 z-50 w-32 flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsMediaMenuOpen(false);
                      imageInputRef.current?.click();
                    }}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-tx-primary hover:bg-app-hover rounded transition-colors text-left"
                  >
                    <ImageIcon size={14} className="text-tx-secondary" />
                    <span>图片</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMediaMenuOpen(false);
                      setShowCamera(true);
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
                      handleMicButtonClick();
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
              "p-2.5 w-10 h-10 flex items-center justify-center rounded-xl transition-colors font-bold text-sm",
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
              className={cn(
                "flex items-center justify-center transition-all font-semibold",
                isMobile ? "w-10 h-10 rounded-xl" : "gap-1 px-2.5 py-1.5 rounded-xl text-xs",
                "text-amber-600 hover:text-amber-700 bg-amber-500/10 hover:bg-amber-500/20 dark:text-amber-400 dark:hover:text-amber-300 dark:bg-amber-500/20"
              )}
              title="撤销 AI 整理"
            >
              <RotateCcw size={isMobile ? 16 : 14} className="text-amber-500" />
              {!isMobile && <span>撤销</span>}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleAIFormat}
              disabled={!text.trim() || formatting}
              className={cn(
                "flex items-center justify-center transition-all font-semibold",
                isMobile ? "w-10 h-10 rounded-xl" : "gap-1 px-2.5 py-1.5 rounded-xl text-xs",
                text.trim() && !formatting
                  ? "bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
                  : "text-tx-tertiary bg-app-subtle cursor-not-allowed opacity-50",
              )}
              title="AI 整理"
            >
              {formatting ? (
                <Loader2 size={isMobile ? 16 : 14} className="animate-spin text-accent-primary" />
              ) : (
                <Sparkles size={isMobile ? 16 : 14} className={text.trim() ? "text-accent-primary" : "text-tx-tertiary"} />
              )}
              {!isMobile && <span>AI整理</span>}
            </button>
          )}
        </div>

      </div>

      
      {/* 提取图片文字弹窗 */}
      <OCRModal
        isOpen={showOCRModal}
        onClose={() => setShowOCRModal(false)}
        onInsert={(recognizedText) => {
          if (textareaRef.current) {
            const start = textareaRef.current.selectionStart;
            const end = textareaRef.current.selectionEnd;
            const newText = text.substring(0, start) + "\n" + recognizedText + "\n" + text.substring(end);
            setText(newText);
            // Move cursor to end of inserted text
            setTimeout(() => {
              textareaRef.current?.setSelectionRange(start + recognizedText.length + 2, start + recognizedText.length + 2);
              textareaRef.current?.focus();
            }, 10);
          } else {
            setText(text + (text ? "\n" : "") + recognizedText);
          }
          pushHistory(text);
        }}
      />

      {/* 拍照弹窗 */}
      <MobileCameraModal
        isOpen={showPhotoCamera}
        onClose={() => setShowPhotoCamera(false)}
        onCapture={handlePhotoCapture}
      />

      {/* 拍照录像弹窗 */}
      <ComposerCameraModal
        isOpen={showCamera}
        onClose={() => setShowCamera(false)}
        onComplete={handleCameraComplete}
      />

      {/* 微信长按文字选中浮动菜单 */}
      {selectionMode && menuCoords && (
        <div
          className={cn(
            "fixed z-[10000] -translate-x-1/2 animate-in fade-in zoom-in-95 duration-100 ease-out pointer-events-auto",
            menuPlacement === "top" ? "-translate-y-full" : "-translate-y-0"
          )}
          style={{
            top: `${menuCoords.top}px`,
            left: `${menuCoords.left}px`,
          }}
        >
          {/* 气泡主体 */}
          <div className="flex items-center bg-app-elevated text-tx-primary text-[11px] rounded-xl shadow-xl border border-app-border divide-x divide-app-border overflow-hidden backdrop-blur-md px-1 py-0.5 select-none animate-in fade-in duration-200">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSelectAll(); }}
              className="px-2.5 py-2 font-medium hover:bg-app-hover transition-colors whitespace-nowrap active:scale-95"
            >
              全选
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopy(); }}
              className="px-2.5 py-2 font-medium hover:bg-app-hover transition-colors whitespace-nowrap active:scale-95"
            >
              复制
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCut(); }}
              className="px-2.5 py-2 font-medium hover:bg-app-hover transition-colors whitespace-nowrap active:scale-95"
            >
              剪切
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePaste(); }}
              className="px-2.5 py-2 font-medium hover:bg-app-hover transition-colors whitespace-nowrap active:scale-95"
            >
              粘贴
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteSelected(); }}
              className="px-2.5 py-2 font-medium text-red-500 hover:bg-red-950/20 transition-colors whitespace-nowrap active:scale-95"
            >
              删除
            </button>
          </div>
          {/* 底部或顶部三角形小指针 */}
          {menuPlacement === "top" ? (
            <div className="w-2 h-2 bg-app-elevated rotate-45 border-r border-b border-app-border absolute left-1/2 -translate-x-1/2 -bottom-[4px]" />
          ) : (
            <div className="w-2 h-2 bg-app-elevated rotate-45 border-l border-t border-app-border absolute left-1/2 -translate-x-1/2 -top-[4px]" />
          )}
        </div>
      )}

      {/* 底部更多功能菜单 (相册/相机/视频) */}
      <AnimatePresence>
        {showMoreOptionsSheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMoreOptionsSheet(false)}
              className="fixed inset-0 bg-black z-[1000] cursor-pointer"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 250 }}
              className="fixed bottom-0 left-0 right-0 bg-app-elevated rounded-t-2xl z-[1001] overflow-hidden select-none safe-bottom pb-safe max-w-lg mx-auto shadow-2xl border-t border-app-border"
            >
              <div className="p-4 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={images.length >= 9}
                  onClick={() => {
                    setShowMoreOptionsSheet(false);
                    imageInputRef.current?.click();
                  }}
                  className="w-full py-3.5 bg-app-surface border border-app-border/40 rounded-xl text-sm font-medium text-tx-primary active:bg-app-hover disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  从相册选择
                </button>
                <button
                  type="button"
                  disabled={images.length >= 9}
                  onClick={() => {
                    setShowMoreOptionsSheet(false);
                    setShowPhotoCamera(true);
                  }}
                  className="w-full py-3.5 bg-app-surface border border-app-border/40 rounded-xl text-sm font-medium text-tx-primary active:bg-app-hover disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  拍摄照片
                </button>
                <button
                  type="button"
                  disabled={images.length >= 9}
                  onClick={() => {
                    setShowMoreOptionsSheet(false);
                    setShowCamera(true);
                  }}
                  className="w-full py-3.5 bg-app-surface border border-app-border/40 rounded-xl text-sm font-medium text-tx-primary active:bg-app-hover disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  录制视频
                </button>
                <div className="h-[4px]" />
                <button
                  type="button"
                  onClick={() => setShowMoreOptionsSheet(false)}
                  className="w-full py-3.5 bg-app-hover hover:bg-app-hover/80 rounded-xl text-sm font-semibold text-tx-secondary active:scale-[0.99] transition-all"
                >
                  取消
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 提醒谁看成员选择页面 (微信风格) */}
      <AnimatePresence>
        {showMemberSelector && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed inset-0 bg-app-elevated z-[1002] flex flex-col select-none overflow-hidden"
          >
            {/* 顶部导航栏 */}
            <div className="border-b border-app-border/50 flex items-center justify-between px-4 shrink-0 bg-app-surface" style={{ paddingTop: "var(--safe-area-top)", height: "calc(3.5rem + var(--safe-area-top))" }}>
              <button
                type="button"
                onClick={() => {
                  setShowMemberSelector(false);
                  setSelectedMemberIds([]);
                  setMemberSearchQuery("");
                }}
                className="p-1 -ml-1 text-tx-secondary hover:text-tx-primary active:opacity-70 transition-all"
              >
                <X size={20} />
              </button>
              <span className="text-sm font-semibold text-tx-primary">提醒谁看</span>
              <button
                type="button"
                onClick={handleConfirmMembers}
                disabled={selectedMemberIds.length === 0}
                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-500 rounded-md text-xs font-semibold text-white active:scale-95 transition-all"
              >
                确定{selectedMemberIds.length > 0 ? `(${selectedMemberIds.length})` : ""}
              </button>
            </div>

            {/* 搜索框 */}
            <div className="p-3 bg-app-surface/40 border-b border-app-border/30 shrink-0">
              <div className="flex items-center gap-2 px-3 py-2 bg-app-surface border border-app-border/60 rounded-lg text-xs">
                <input
                  type="text"
                  placeholder="搜索"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  className="w-full bg-transparent outline-none text-tx-primary placeholder:text-tx-tertiary"
                />
              </div>
            </div>

            {/* 成员列表与字母索引 */}
            <div className="flex-1 min-h-0 flex relative">
              {/* 列表区 */}
              <div className="flex-1 overflow-y-auto pr-8 py-2 space-y-4">
                {loadingMembers ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 text-accent-primary animate-spin" />
                  </div>
                ) : Object.keys(groupedMembers).length === 0 ? (
                  <div className="text-center text-tx-tertiary py-12 text-xs">
                    无可选成员
                  </div>
                ) : (
                  (Object.entries(groupedMembers) as [string, WorkspaceMember[]][]).map(([letter, list]) => (
                    <div key={letter} id={`member-section-${letter}`} className="space-y-1">
                      <div className="px-4 py-1 bg-app-hover/30 text-[11px] font-semibold text-tx-tertiary">
                        {letter}
                      </div>
                      <div className="divide-y divide-app-border/30">
                        {list.map((m: WorkspaceMember) => {
                          const isChecked = selectedMemberIds.includes(m.userId);
                          return (
                            <div
                              key={m.userId}
                              onClick={() => {
                                setSelectedMemberIds((prev: string[]) =>
                                  isChecked
                                    ? prev.filter((id: string) => id !== m.userId)
                                    : [...prev, m.userId]
                                );
                              }}
                              className="flex items-center gap-3 px-4 py-3 hover:bg-app-hover/40 active:bg-app-hover/70 transition-colors cursor-pointer"
                            >
                              {/* 圆形选择框 */}
                              <div
                                className={cn(
                                  "w-5 h-5 rounded-full border flex items-center justify-center transition-all",
                                  isChecked
                                    ? "bg-emerald-500 border-emerald-500 text-white"
                                    : "border-app-border/80 bg-transparent"
                                )}
                              >
                                {isChecked && <Check size={12} strokeWidth={3} />}
                              </div>
                              {/* 头像 */}
                              <div className="w-9 h-9 rounded-full bg-accent-primary/10 flex items-center justify-center text-accent-primary font-bold text-sm overflow-hidden shrink-0 border border-app-border/30">
                                {m.avatarUrl ? (
                                  <img src={m.avatarUrl} alt={memberDisplayName(m)} className="w-full h-full object-cover" />
                                ) : (
                                  memberDisplayName(m).charAt(0).toUpperCase()
                                )}
                              </div>
                              {/* 名字：优先昵称，副文案保留用户名 */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-tx-primary font-medium truncate">{memberDisplayName(m)}</p>
                                {m.displayName && m.displayName.trim() && m.displayName !== m.username ? (
                                  <p className="text-[10px] text-tx-tertiary truncate">@{m.username}</p>
                                ) : m.email ? (
                                  <p className="text-[10px] text-tx-tertiary truncate">{m.email}</p>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 字母侧边栏 */}
              <div className="absolute right-1 top-1/2 -translate-y-1/2 w-6 flex flex-col items-center gap-1 py-2 rounded-lg bg-app-surface/30 backdrop-blur-sm border border-app-border/20 text-[10px] font-bold text-tx-tertiary select-none">
                {Object.keys(groupedMembers).map((letter) => (
                  <button
                    key={letter}
                    onClick={() => scrollToSection(letter)}
                    className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-emerald-500 hover:text-white active:scale-90 transition-all"
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* 全屏录音遮罩 */}
      {showVoiceRecorder && (
        <div className="fixed inset-0 z-[80] bg-gradient-to-b from-[#0e1117] via-[#0b0d13] to-black text-white flex flex-col justify-between p-6 overflow-hidden">
          {/* 顶栏 */}
          <div className="flex items-center justify-between" style={{ paddingTop: "var(--safe-area-top)" }}>
            <button
              onClick={handleCancelVoiceRecord}
              className="p-2 rounded-full bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
            >
              <X size={20} />
            </button>
            <span className="text-sm font-semibold tracking-wider text-white/90">录音说说</span>
            <div className="w-9" /> {/* Spacer to balance the X button */}
          </div>

          {/* 中间麦克风 (Area 1 - Waveform + Mic status) */}
          <div className="flex-1 flex flex-col items-center justify-center space-y-8 min-h-0 mt-4">


            <div className="relative flex items-center justify-center">
              {recording && !isPaused && (
                <motion.div
                  animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0.1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                  className="absolute w-32 h-32 rounded-full bg-[#6366f1]/20 blur-xl"
                />
              )}
              <div
                className="relative w-24 h-24 rounded-full flex items-center justify-center shadow-2xl z-10 transition-all duration-300"
                style={{
                  backgroundColor: recording && !isPaused ? "#6366f1" : "rgba(255,255,255,0.08)",
                  border: "2px solid rgba(255,255,255,0.15)",
                  color: "white"
                }}
              >
                {recording && !isPaused ? (
                  <div className="flex items-end justify-center gap-[3px] h-10 px-2">
                    {[3, 5, 7, 9, 11, 13, 15, 17, 19].map((waveIdx) => {
                      const val = waveValues[waveIdx] || 0.05;
                      return (
                        <motion.div
                          key={waveIdx}
                          animate={{ height: `${Math.max(4, val * 32)}px` }}
                          transition={{ type: "spring", stiffness: 300, damping: 15 }}
                          className="w-1 rounded-full bg-white"
                        />
                      );
                    })}
                  </div>
                ) : (
                  <Mic size={36} />
                )}
              </div>
            </div>

            <div className="text-center space-y-2">
              <span className="text-3xl font-bold text-white tracking-wide font-mono">
                {Math.floor(recordDuration / 60).toString().padStart(2, "0")}:{(recordDuration % 60).toString().padStart(2, "0")}
              </span>
              <p className="text-xs text-white/50">
                {isPaused ? "录音已暂停" : recording ? "正在录音，点击下方按钮暂停或完成" : "已停止，点击下方完成保存"}
              </p>
            </div>
          </div>

          {/* 底部动作 (Area 2 - Cancel, Pause/Resume, Finish) */}
          <div className="flex items-center justify-center gap-6 pb-[calc(var(--safe-area-bottom)+24px)] shrink-0">
            {/* 取消按钮 */}
            <button
              onClick={handleCancelVoiceRecord}
              className="w-14 h-14 rounded-full border border-white/10 bg-white/5 text-white/60 flex flex-col items-center justify-center active:scale-95 transition-all text-[10px] font-medium shadow-lg hover:bg-white/10 hover:text-white"
            >
              <X size={18} className="mb-0.5" />
              <span>取消</span>
            </button>

            {/* 暂停/继续按钮 */}
            <button
              onClick={handleTogglePauseVoiceRecord}
              disabled={!recording}
              className={cn(
                "w-16 h-16 rounded-full flex flex-col items-center justify-center active:scale-95 transition-all text-xs font-bold shadow-lg disabled:opacity-40 disabled:pointer-events-none",
                isPaused
                  ? "bg-[#6366f1] text-white hover:bg-[#4f46e5]"
                  : "bg-white/5 border border-white/15 text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              {isPaused ? (
                <>
                  <Play size={20} className="mb-0.5" fill="currentColor" />
                  <span>继续</span>
                </>
              ) : (
                <>
                  <Pause size={20} className="mb-0.5" fill="currentColor" />
                  <span>暂停</span>
                </>
              )}
            </button>

            {/* 完成按钮 */}
            <button
              onClick={handleFinishVoiceRecord}
              disabled={recordDuration === 0 && !recording}
              className="w-14 h-14 rounded-full text-white bg-[#6366f1] hover:bg-[#4f46e5] flex flex-col items-center justify-center active:scale-95 transition-all text-[10px] font-medium shadow-lg disabled:opacity-40 disabled:pointer-events-none"
            >
              <Check size={18} className="mb-0.5" />
              <span>完成</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (isMobile) return shell;

  // 桌面：遮罩 + 居中大弹窗（非全屏页）
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-zinc-900/45 dark:bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ type: "spring", duration: 0.35, bounce: 0 }}
        className="relative z-10 w-full max-w-2xl flex justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {shell}
      </motion.div>
    </div>
  );
}
