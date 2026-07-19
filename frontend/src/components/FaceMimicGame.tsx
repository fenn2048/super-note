import React, { useState, useEffect, useRef, useCallback } from "react";
import { CheckCircle2, Smile } from "lucide-react";
import type { FaceLandmarker as FaceLandmarkerType } from "@mediapipe/tasks-vision";
import { motion, AnimatePresence } from "framer-motion";

interface FaceMimicGameProps {
  onComplete: () => void;
  completed: boolean;
  stream: MediaStream | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  goodThreshold: number;
  wonderfulThreshold: number;
}

const EXPRESSIONS = [
  { id: "smile", emoji: "😊", label: "微笑", blendshapes: ["mouthSmileLeft", "mouthSmileRight"], maxScore: 2 },
  { id: "surprise", emoji: "😲", label: "惊讶", blendshapes: ["jawOpen", "eyeWideLeft", "eyeWideRight"], maxScore: 3 },
  { id: "sad", emoji: "😢", label: "悲伤", blendshapes: ["mouthFrownLeft", "mouthFrownRight"], maxScore: 2 },
  { id: "angry", emoji: "😠", label: "生气", blendshapes: ["browDownLeft", "browDownRight"], maxScore: 2 },
  { id: "kiss", emoji: "😗", label: "嘟嘴", blendshapes: ["mouthPucker"], maxScore: 1 },
  { id: "wink", emoji: "😜", label: "眨眼", blendshapes: ["eyeBlinkLeft", "eyeBlinkRight"], minDiff: 0.5, maxScore: 1 }, // Custom logic for wink
];

export default function FaceMimicGame({ onComplete, completed, stream, videoRef, goodThreshold, wonderfulThreshold }: FaceMimicGameProps) {
  const [currentExprIndex, setCurrentExprIndex] = useState(0);
  const [similarity, setSimilarity] = useState(0);
  const [feedback, setFeedback] = useState<"None" | "Good" | "Wonderful">("None");
  const [landmarker, setLandmarker] = useState<FaceLandmarkerType | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const requestRef = useRef<number>();
  const lastVideoTimeRef = useRef<number>(-1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    let active = true;
    const initFaceLandmarker = async () => {
      try {
        // 动态 import mediapipe，避免未打开健康提醒时进主包
        const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        const fb = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });
        if (active) {
          setLandmarker(fb);
          setIsModelLoading(false);
        }
      } catch (err) {
        console.error("Error loading FaceLandmarker:", err);
        setIsModelLoading(false);
      }
    };
    initFaceLandmarker();
    return () => {
      active = false;
      if (landmarker) landmarker.close();
    };
  }, []);

  const calculateSimilarity = useCallback((blendshapes: any[], targetExpr: typeof EXPRESSIONS[0]) => {
    if (!blendshapes || blendshapes.length === 0) return 0;

    // Create a map for easy lookup
    const scores = new Map<string, number>();
    for (const shape of blendshapes[0].categories) {
       scores.set(shape.categoryName, shape.score);
    }

    let score = 0;
    if (targetExpr.id === "wink") {
      const blinkLeft = scores.get("eyeBlinkLeft") || 0;
      const blinkRight = scores.get("eyeBlinkRight") || 0;
      const diff = Math.abs(blinkLeft - blinkRight);
      // We want a high difference for a wink
      score = diff > targetExpr.minDiff! ? 1 : diff / targetExpr.minDiff!;
    } else {
       for (const shapeName of targetExpr.blendshapes) {
         score += (scores.get(shapeName) || 0);
       }
    }

    // Normalize to 0-100
    return Math.min(100, Math.round((score / targetExpr.maxScore) * 100));
  }, []);


  const detectFace = useCallback(() => {
    if (!landmarker || !videoRef.current || !canvasRef.current || !stream) {
        requestRef.current = requestAnimationFrame(detectFace);
        return;
    }

    const video = videoRef.current;

    // Ensure video is playing and has valid dimensions
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        requestRef.current = requestAnimationFrame(detectFace);
        return;
    }

    const startTimeMs = performance.now();
    if (lastVideoTimeRef.current !== video.currentTime) {
      lastVideoTimeRef.current = video.currentTime;
      try {
        const results = landmarker.detectForVideo(video, startTimeMs);

        // Draw emoji overlay
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (ctx && results.faceLandmarks && results.faceLandmarks.length > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const landmarks = results.faceLandmarks[0];
            // Get center of face (nose tip is usually ~1)
            const noseTip = landmarks[1];
            // get width of face from cheeks (234 and 454)
            const leftCheek = landmarks[234];
            const rightCheek = landmarks[454];

            if (noseTip && leftCheek && rightCheek) {
              const x = noseTip.x * canvas.width;
              const y = noseTip.y * canvas.height;
              // calculate roughly the face width
              const faceWidth = Math.abs(rightCheek.x - leftCheek.x) * canvas.width;
              const emojiSize = faceWidth * 1.5; // Make it big enough to cover head

              ctx.font = `${emojiSize}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";

              // Depending on expression, show a different animal
              const currentEmoji = EXPRESSIONS[currentExprIndex].id === "smile" ? "🐶" :
                                   EXPRESSIONS[currentExprIndex].id === "surprise" ? "🙀" :
                                   EXPRESSIONS[currentExprIndex].id === "sad" ? "😿" :
                                   EXPRESSIONS[currentExprIndex].id === "angry" ? "😾" :
                                   EXPRESSIONS[currentExprIndex].id === "kiss" ? "😘" : "🦊";

              ctx.fillText(currentEmoji, x, y);
            }
        } else if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // Store latest blendshapes for interval check
        if (results.faceBlendshapes) {
           canvas.dataset.latestBlendshapes = JSON.stringify(results.faceBlendshapes);
        }

      } catch (err) {
        console.warn("Face detection error:", err);
      }
    }
    requestRef.current = requestAnimationFrame(detectFace);
  }, [landmarker, stream, currentExprIndex]);


  useEffect(() => {
    if (landmarker && !completed) {
      requestRef.current = requestAnimationFrame(detectFace);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [landmarker, detectFace, completed]);

  // Check expression every 2 seconds
  useEffect(() => {
    if (completed || isModelLoading || !landmarker) return;

    checkIntervalRef.current = setInterval(() => {
       const blendshapesStr = canvasRef.current?.dataset.latestBlendshapes;
       if (blendshapesStr) {
           try {
               const blendshapes = JSON.parse(blendshapesStr);
               const currentExpr = EXPRESSIONS[currentExprIndex];
               const sim = calculateSimilarity(blendshapes, currentExpr);
               setSimilarity(sim);

               if (sim >= wonderfulThreshold) {
                   setFeedback("Wonderful");
                   setTimeout(() => {
                       if (currentExprIndex < EXPRESSIONS.length - 1) {
                           setCurrentExprIndex(prev => prev + 1);
                           setFeedback("None");
                           setSimilarity(0);
                       } else {
                           onComplete();
                       }
                   }, 1500);
               } else if (sim >= goodThreshold) {
                   setFeedback("Good");
                   setTimeout(() => {
                       if (feedback !== "Wonderful") {
                         setFeedback("None");
                       }
                   }, 1500);
               }
           } catch(e) {
               // ignore json parse error
           }
       }
    }, 2000);

    return () => {
        if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, [completed, currentExprIndex, goodThreshold, wonderfulThreshold, isModelLoading, landmarker, onComplete, feedback, calculateSimilarity]);


  return (
    <div className="absolute inset-0 flex p-4 gap-4 animate-in fade-in zoom-in duration-500 bg-white/50 dark:bg-zinc-900/50">
      {/* Left side: Target Expression */}
      <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-4">
          <h3 className="text-lg font-bold text-tx-primary mb-2">模仿此表情</h3>
          {completed ? (
              <div className="text-center">
                 <CheckCircle2 className="w-20 h-20 text-emerald-500 mx-auto mb-4" />
                 <p className="text-tx-secondary font-medium">挑战完成！</p>
              </div>
          ) : (
             <>
                <div className="text-8xl mb-4 transition-all duration-300">
                    {EXPRESSIONS[currentExprIndex].emoji}
                </div>
                <div className="text-xl font-medium text-tx-secondary mb-2">
                    {EXPRESSIONS[currentExprIndex].label}
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {currentExprIndex + 1} / {EXPRESSIONS.length}
                </div>
             </>
          )}

      </div>

      {/* Right side: Camera Feedback */}
      <div className="flex-1 relative flex flex-col bg-zinc-900 rounded-2xl overflow-hidden shadow-inner">
          {/* We reuse the video feed from SpaceshipReminder, but we overlay a canvas here */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-cover z-10"
          />

          <div className="absolute top-4 left-4 z-20 bg-black/50 text-white px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-md">
             相似度: {similarity}%
          </div>

          {/* Feedback Animation */}
          <AnimatePresence>
            {feedback !== "None" && !completed && (
                <motion.div
                   initial={{ scale: 0.5, opacity: 0, y: 20 }}
                   animate={{ scale: 1, opacity: 1, y: 0 }}
                   exit={{ scale: 0.8, opacity: 0 }}
                   className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
                >
                    <div className={`text-4xl font-extrabold px-6 py-3 rounded-2xl shadow-2xl transform -rotate-12 ${
                        feedback === "Wonderful"
                            ? "bg-gradient-to-r from-pink-500 to-purple-500 text-white border-4 border-white/20"
                            : "bg-gradient-to-r from-emerald-400 to-teal-500 text-white border-4 border-white/20"
                    }`}>
                        {feedback}!
                    </div>
                </motion.div>
            )}
          </AnimatePresence>

          {isModelLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-40 bg-zinc-900/80 backdrop-blur-sm text-white">
                 <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                 <p className="text-sm font-medium">加载 AI 面部追踪模型...</p>
              </div>
          )}
      </div>
    </div>
  );
}
