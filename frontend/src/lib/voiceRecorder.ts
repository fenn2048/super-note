/** Voice notes: mono speech at 24 kbps. Chromium → Opus/WebM; iOS → AAC/MP4. */

export const VOICE_AUDIO_BITS_PER_SECOND = 24_000;

export const VOICE_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

const VOICE_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export function pickVoiceMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return VOICE_MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export function stripVoiceMime(raw: string | undefined | null): string {
  const mime = (raw || "").split(";")[0].trim().toLowerCase();
  return mime || "audio/webm";
}

export function voiceFileExtension(mime: string): string {
  const m = stripVoiceMime(mime);
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "webm";
}

export function createVoiceMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = pickVoiceMimeType();
  const withBitrate: MediaRecorderOptions = {
    audioBitsPerSecond: VOICE_AUDIO_BITS_PER_SECOND,
  };
  if (mimeType) withBitrate.mimeType = mimeType;
  try {
    return new MediaRecorder(stream, withBitrate);
  } catch {
    try {
      return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      return new MediaRecorder(stream);
    }
  }
}

export function getVoiceMediaStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(VOICE_AUDIO_CONSTRAINTS);
}

export function voiceFileFromBlob(blob: Blob, basename = `voice_${Date.now()}`): File {
  const mime = stripVoiceMime(blob.type);
  const ext = voiceFileExtension(mime);
  const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
  return new File([typed], `${basename}.${ext}`, { type: mime });
}

export function voiceBlobFromChunks(chunks: Blob[], mimeHint?: string): Blob {
  const mime = stripVoiceMime(mimeHint || chunks[0]?.type);
  return new Blob(chunks, { type: mime });
}
