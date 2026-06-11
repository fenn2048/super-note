import React, { useRef, useState, useEffect } from "react";
import { X, Camera, RefreshCw, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/lib/toast";

interface MobileCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export default function MobileCameraModal({ isOpen, onClose, onCapture }: MobileCameraModalProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Start stream
  const startCamera = async (mode: "user" | "environment") => {
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      setLoading(true);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Failed to open camera:", err);
      toast.error("无法访问摄像头，请检查权限设置");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && !capturedBlob) {
      startCamera(facingMode);
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isOpen, facingMode, capturedBlob]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !stream) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    canvas.width = videoWidth;
    canvas.height = videoHeight;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedBlob(blob);
          setPreviewUrl(URL.createObjectURL(blob));
          // Stop stream to release camera
          stream.getTracks().forEach((track) => track.stop());
          setStream(null);
        }
      },
      "image/jpeg",
      0.9
    );
  };

  const handleRetake = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setCapturedBlob(null);
    setPreviewUrl(null);
  };

  const handleDone = () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
    onCapture(file);
    handleClose();
  };

  const handleClose = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    setStream(null);
    setCapturedBlob(null);
    setPreviewUrl(null);
    onClose();
  };

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col justify-between overflow-hidden">
      {/* Top Bar */}
      <div className="absolute top-0 inset-x-0 h-16 flex items-center justify-between px-4 z-10 bg-gradient-to-b from-black/60 to-transparent">
        <button
          onClick={handleClose}
          className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white active:scale-90 transition-transform"
        >
          <X size={20} />
        </button>
        <span className="text-white text-sm font-semibold">
          {capturedBlob ? "预览照片" : "拍照"}
        </span>
        {!capturedBlob ? (
          <button
            onClick={toggleFacingMode}
            className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white active:scale-90 transition-transform"
          >
            <RefreshCw size={20} />
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      {/* Main Viewport */}
      <div className="flex-1 flex items-center justify-center relative bg-zinc-950">
        {loading && !previewUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-zinc-400">正在启动相机...</span>
          </div>
        )}

        <video
          ref={videoRef}
          playsInline
          autoPlay
          className={`w-full h-full object-cover max-h-[85vh] ${capturedBlob ? "hidden" : "block"}`}
        />

        {previewUrl && (
          <img
            src={previewUrl}
            alt="Captured preview"
            className="w-full h-full object-contain max-h-[85vh]"
          />
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Bottom Actions */}
      <div className="h-32 bg-black flex items-center justify-center px-8 z-10 pb-safe">
        {!capturedBlob ? (
          <button
            onClick={handleCapture}
            disabled={loading}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-transparent active:scale-95 transition-transform disabled:opacity-40"
          >
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center">
              <Camera size={28} className="text-black" />
            </div>
          </button>
        ) : (
          <div className="flex items-center justify-around w-full max-w-xs">
            <button
              onClick={handleRetake}
              className="flex flex-col items-center gap-1 text-white active:scale-90 transition-transform"
            >
              <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                <RefreshCw size={20} />
              </div>
              <span className="text-xs text-zinc-300">重拍</span>
            </button>
            <button
              onClick={handleDone}
              className="flex flex-col items-center gap-1 text-white active:scale-90 transition-transform"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center">
                <Check size={24} />
              </div>
              <span className="text-xs text-emerald-400 font-semibold">使用照片</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
