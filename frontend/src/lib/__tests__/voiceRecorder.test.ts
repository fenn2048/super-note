import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VOICE_AUDIO_BITS_PER_SECOND,
  createVoiceMediaRecorder,
  pickVoiceMimeType,
  stripVoiceMime,
  voiceBlobFromChunks,
  voiceFileExtension,
  voiceFileFromBlob,
} from "@/lib/voiceRecorder";

type FakeRecorderOptions = { mimeType?: string; audioBitsPerSecond?: number };

class FakeMediaRecorder {
  static supported: string[] = [];
  static lastOptions: FakeRecorderOptions | undefined;
  mimeType: string;
  state = "inactive";

  static isTypeSupported(t: string) {
    return FakeMediaRecorder.supported.includes(t);
  }

  constructor(_stream: MediaStream, options?: FakeRecorderOptions) {
    FakeMediaRecorder.lastOptions = options;
    this.mimeType = options?.mimeType || "";
  }
}

function installFakeRecorder() {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
}

afterEach(() => {
  FakeMediaRecorder.supported = [];
  FakeMediaRecorder.lastOptions = undefined;
  vi.unstubAllGlobals();
});

describe("stripVoiceMime / voiceFileExtension", () => {
  it("strips codecs suffix", () => {
    expect(stripVoiceMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(stripVoiceMime("audio/mp4")).toBe("audio/mp4");
    expect(stripVoiceMime("")).toBe("audio/webm");
  });

  it("maps container to file extension", () => {
    expect(voiceFileExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(voiceFileExtension("audio/mp4")).toBe("m4a");
    expect(voiceFileExtension("audio/aac")).toBe("m4a");
    expect(voiceFileExtension("audio/ogg;codecs=opus")).toBe("ogg");
  });
});

describe("pickVoiceMimeType / createVoiceMediaRecorder", () => {
  it("prefers Opus in WebM when the browser supports it", () => {
    installFakeRecorder();
    FakeMediaRecorder.supported = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    expect(pickVoiceMimeType()).toBe("audio/webm;codecs=opus");

    const rec = createVoiceMediaRecorder({} as MediaStream);
    expect(FakeMediaRecorder.lastOptions).toEqual({
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: VOICE_AUDIO_BITS_PER_SECOND,
    });
    expect(rec.mimeType).toBe("audio/webm;codecs=opus");
  });

  it("falls back to AAC-in-MP4 when WebM is unavailable", () => {
    installFakeRecorder();
    FakeMediaRecorder.supported = ["audio/mp4"];
    expect(pickVoiceMimeType()).toBe("audio/mp4");

    createVoiceMediaRecorder({} as MediaStream);
    expect(FakeMediaRecorder.lastOptions).toEqual({
      mimeType: "audio/mp4",
      audioBitsPerSecond: VOICE_AUDIO_BITS_PER_SECOND,
    });
  });
});

describe("voiceBlobFromChunks / voiceFileFromBlob", () => {
  it("builds a typed file whose name matches the container", () => {
    const blob = voiceBlobFromChunks(
      [new Blob(["abc"], { type: "audio/webm;codecs=opus" })],
      "audio/webm;codecs=opus",
    );
    expect(blob.type).toBe("audio/webm");
    const file = voiceFileFromBlob(blob, "voice");
    expect(file.name).toBe("voice.webm");
    expect(file.type).toBe("audio/webm");
  });

  it("uses .m4a for mp4 voice notes", () => {
    const file = voiceFileFromBlob(new Blob(["x"], { type: "audio/mp4" }), "voice");
    expect(file.name).toBe("voice.m4a");
    expect(file.type).toBe("audio/mp4");
  });
});
