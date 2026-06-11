import React, { useRef, useState, useEffect } from "react";
import { X, Video, RefreshCw, Check, Play, Pause, Circle, Plus } from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface ComposerCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (files: File[]) => void;
}

export default function ComposerCameraModal({ isOpen, onClose, onComplete }: ComposerCameraModalProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [capturedClips, setCapturedClips] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationTimerRef = useRef<any>(null);

  const startCamera = async (mode: "user" | "environment") => {
    try {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setLoading(true);
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch (err) {
      console.error("Camera access failed:", err);
      toast.error("无法启动相机，请检查摄像头和麦克风权限");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && !recordedBlob) {
      startCamera(facingMode);
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [isOpen, facingMode, recordedBlob]);

  // Track recording duration
  useEffect(() => {
    if (recording) {
      durationTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      setRecordDuration(0);
    }
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [recording]);

  const handleStartRecord = () => {
    if (!stream) return;
    chunksRef.current = [];
    
    // Choose mime type
    let options = { mimeType: "video/webm;codecs=vp9,opus" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm;codecs=vp8,opus" };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm" };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/mp4" };
    }

    try {
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/mp4" });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
      };

      recorder.start(200);
      setRecording(true);
    } catch (err) {
      console.error("Failed to start MediaRecorder:", err);
      toast.error("录制启动失败");
    }
  };

  const handleStopRecord = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  };

  const handleRetake = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
  };

  const saveCurrentClip = (): File | null => {
    if (!recordedBlob) return null;
    const extension = recordedBlob.type.includes("mp4") ? "mp4" : "webm";
    return new File(
      [recordedBlob],
      `clip_${Date.now()}.${extension}`,
      { type: recordedBlob.type }
    );
  };

  const handleTakeAnother = () => {
    const file = saveCurrentClip();
    if (file) {
      setCapturedClips((prev) => [...prev, file]);
      toast.success("已保存当前视频，开始录制下一个");
    }
    handleRetake();
  };

  const handleDone = () => {
    const currentFile = saveCurrentClip();
    const finalClips = [...capturedClips];
    if (currentFile) {
      finalClips.push(currentFile);
    }
    if (finalClips.length > 0) {
      onComplete(finalClips);
    }
    handleClose();
  };

  const handleClose = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setCapturedClips([]);
    onClose();
  };

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col justify-between overflow-hidden">
      {/* Top Header */}
      <div className="absolute top-0 inset-x-0 h-16 flex items-center justify-between px-4 z-10 bg-gradient-to-b from-black/60 to-transparent">
        <button
          onClick={handleClose}
          className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white active:scale-90"
        >
          <X size={20} />
        </button>
        <span className="text-white text-xs font-semibold">
          {recordedBlob ? `预览视频 (已录 ${capturedClips.length} 段)` : `录制说说视频 (${capturedClips.length} 已录)`}
        </span>
        {!recordedBlob && !recording ? (
          <button
            onClick={toggleFacingMode}
            className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white active:scale-90"
          >
            <RefreshCw size={20} />
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      {/* Main Screen */}
      <div className="flex-1 flex items-center justify-center relative bg-zinc-950">
        {loading && !recordedUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-zinc-400">正在启动相机...</span>
          </div>
        )}

        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className={`w-full h-full object-cover max-h-[85vh] ${recordedBlob ? "hidden" : "block"}`}
        />

        {recordedUrl && (
          <video
            ref={previewVideoRef}
            src={recordedUrl}
            playsInline
            controls
            autoPlay
            loop
            className="w-full h-full object-contain max-h-[85vh]"
          />
        )}

        {/* Recording Indicator */}
        {recording && (
          <div className="absolute top-20 left-4 flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/80 text-white text-xs font-bold animate-pulse">
            <div className="w-2 h-2 rounded-full bg-white" />
            <span>录制中 {Math.floor(recordDuration / 60)}:{(recordDuration % 60).toString().padStart(2, "0")}</span>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="h-36 bg-black flex items-center justify-center px-4 z-10 pb-safe">
        {!recordedBlob ? (
          <button
            onClick={recording ? handleStopRecord : handleStartRecord}
            disabled={loading}
            className={cn(
              "w-20 h-20 rounded-full border-4 flex items-center justify-center bg-transparent active:scale-95 transition-all",
              recording ? "border-red-500" : "border-white"
            )}
          >
            {recording ? (
              <div className="w-8 h-8 rounded bg-red-500" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center">
                <Video size={24} className="text-white" />
              </div>
            )}
          </button>
        ) : (
          <div className="flex flex-col items-center gap-4 w-full">
            <div className="flex items-center justify-around w-full max-w-sm">
              <button
                onClick={handleRetake}
                className="flex flex-col items-center gap-1 text-white active:scale-90"
              >
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                  <RefreshCw size={18} />
                </div>
                <span className="text-[10px] text-zinc-400">重拍</span>
              </button>

              <button
                onClick={handleTakeAnother}
                className="flex flex-col items-center gap-1 text-white active:scale-90"
              >
                <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                  <Plus size={20} className="text-white" />
                </div>
                <span className="text-[10px] text-zinc-300 font-medium">再拍一个</span>
              </button>

              <button
                onClick={handleDone}
                className="flex flex-col items-center gap-1 text-white active:scale-90"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center">
                  <Check size={20} />
                </div>
                <span className="text-[10px] text-emerald-400 font-semibold">完成</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
