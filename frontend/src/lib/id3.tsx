import React, { useEffect, useState } from "react";
import { api, resolveAttachmentUrl, getBaseUrl } from "@/lib/api";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";

// Memory cache to prevent parsing the same audio repeatedly during current session
const id3CoverCache = new Map<string, string>();
const id3MetaCache = new Map<string, ID3Metadata>();

export interface ID3Metadata {
  artist?: string;
  album?: string;
  title?: string;
  coverUrl?: string;
  coverBlob?: Blob;
}

function decodeId3Text(encoding: number, data: Uint8Array): string {
  try {
    if (encoding === 0) {
      // ISO-8859-1
      return new TextDecoder("iso-8859-1").decode(data).replace(/\0/g, "").trim();
    }
    if (encoding === 1) {
      // UTF-16 with BOM
      return new TextDecoder("utf-16").decode(data).replace(/\0/g, "").trim();
    }
    if (encoding === 2) {
      // UTF-16BE without BOM
      return new TextDecoder("utf-16be").decode(data).replace(/\0/g, "").trim();
    }
    // encoding 3 = UTF-8
    return new TextDecoder("utf-8").decode(data).replace(/\0/g, "").trim();
  } catch {
    return new TextDecoder().decode(data).replace(/\0/g, "").trim();
  }
}

function readTextFrame(buffer: Uint8Array, frameDataOffset: number, frameSize: number): string {
  if (frameSize < 2) return "";
  const encoding = buffer[frameDataOffset];
  const textBytes = buffer.subarray(frameDataOffset + 1, frameDataOffset + frameSize);
  return decodeId3Text(encoding, textBytes);
}

/**
 * Streaming parser that fetches up to 4MB of an audio file and extracts
 * ID3v2 cover art (APIC/PIC) plus text frames (TPE1/TALB/TIT2).
 */
export async function getID3Metadata(url: string): Promise<ID3Metadata | null> {
  try {
    const absoluteUrl = resolveAttachmentUrl(url);
    const token = localStorage.getItem("super-token");
    const headers: HeadersInit = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(absoluteUrl, { headers });
    if (!response.ok) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let receivedLength = 0;
    const maxBytes = 4 * 1024 * 1024; // Up to 4MB is more than enough for metadata + APIC

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedLength += value.length;
      if (receivedLength >= maxBytes) {
        await reader.cancel();
        break;
      }
    }

    const buffer = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, position);
      position += chunk.length;
    }

    // Verify ID3 v2.x tag header
    if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) {
      return null;
    }

    const versionMajor = buffer[3];
    const flags = buffer[5];

    // Synchsafe integer size calculation (4 bytes, 7 bits each)
    const s0 = buffer[6];
    const s1 = buffer[7];
    const s2 = buffer[8];
    const s3 = buffer[9];
    const tagSize = (s0 << 21) | (s1 << 14) | (s2 << 7) | s3;

    let offset = 10;

    // Skip extended header if present
    if ((flags & 0x40) !== 0) {
      const extSize = versionMajor === 4
        ? (((buffer[10] << 21) | (buffer[11] << 14) | (buffer[12] << 7) | buffer[13]) >>> 0)
        : (((buffer[10] << 24) | (buffer[11] << 16) | (buffer[12] << 8) | buffer[13]) >>> 0);
      offset += (versionMajor === 4 ? extSize : extSize + 4);
    }

    const isV2 = versionMajor === 2;
    const isV3 = versionMajor === 3;
    const isV4 = versionMajor === 4;

    const meta: ID3Metadata = {};

    while (offset < Math.min(tagSize + 10, buffer.length)) {
      let frameId = "";
      let frameSize = 0;
      let headerSize = 0;

      if (isV2) {
        frameId = String.fromCharCode(buffer[offset], buffer[offset + 1], buffer[offset + 2]);
        frameSize = (buffer[offset + 3] << 16) | (buffer[offset + 4] << 8) | (buffer[offset + 5]);
        headerSize = 6;
      } else if (isV3 || isV4) {
        frameId = String.fromCharCode(buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]);
        if (isV4) {
          // ID3v2.4 uses synchsafe size for frames as well
          frameSize = ((buffer[offset + 4] << 21) | (buffer[offset + 5] << 14) | (buffer[offset + 6] << 7) | buffer[offset + 7]) >>> 0;
        } else {
          // ID3v2.3 uses regular size
          frameSize = ((buffer[offset + 4] << 24) | (buffer[offset + 5] << 16) | (buffer[offset + 6] << 8) | buffer[offset + 7]) >>> 0;
        }
        headerSize = 10;
      } else {
        break;
      }

      if (frameSize <= 0 || offset + headerSize + frameSize > buffer.length) {
        break;
      }

      const frameDataOffset = offset + headerSize;

      // Cover image frame ("PIC" in v2, "APIC" in v3/v4)
      if ((isV2 && frameId === "PIC") || ((isV3 || isV4) && frameId === "APIC")) {
        if (!meta.coverUrl) {
          let p = frameDataOffset;
          const textEncoding = buffer[p];
          p += 1;

          let mimeType = "";
          if (isV2) {
            const format = String.fromCharCode(buffer[p], buffer[p + 1], buffer[p + 2]);
            mimeType = format.toLowerCase() === "png" ? "image/png" : "image/jpeg";
            p += 3;
          } else {
            let mimeEnd = p;
            while (mimeEnd < frameDataOffset + frameSize && buffer[mimeEnd] !== 0) {
              mimeEnd++;
            }
            mimeType = new TextDecoder().decode(buffer.subarray(p, mimeEnd));
            p = mimeEnd + 1;
          }

          // Skip picture type byte
          p += 1;

          // Skip description null-terminated string
          if (textEncoding === 0 || textEncoding === 3) {
            while (p < frameDataOffset + frameSize && buffer[p] !== 0) {
              p++;
            }
            p += 1;
          } else {
            while (p + 1 < frameDataOffset + frameSize && !(buffer[p] === 0 && buffer[p + 1] === 0)) {
              p += 2;
            }
            p += 2;
          }

          const imgData = buffer.subarray(p, frameDataOffset + frameSize);
          const blob = new Blob([imgData], { type: mimeType || "image/jpeg" });
          meta.coverBlob = blob;
          meta.coverUrl = URL.createObjectURL(blob);
        }
      }

      // Text frames
      if (isV2) {
        if (frameId === "TP1" && !meta.artist) meta.artist = readTextFrame(buffer, frameDataOffset, frameSize);
        if (frameId === "TAL" && !meta.album) meta.album = readTextFrame(buffer, frameDataOffset, frameSize);
        if (frameId === "TT2" && !meta.title) meta.title = readTextFrame(buffer, frameDataOffset, frameSize);
      } else {
        if ((frameId === "TPE1" || frameId === "TPE2") && !meta.artist) {
          meta.artist = readTextFrame(buffer, frameDataOffset, frameSize);
        }
        if (frameId === "TALB" && !meta.album) {
          meta.album = readTextFrame(buffer, frameDataOffset, frameSize);
        }
        if (frameId === "TIT2" && !meta.title) {
          meta.title = readTextFrame(buffer, frameDataOffset, frameSize);
        }
      }

      offset += headerSize + frameSize;
    }

    if (!meta.artist && !meta.album && !meta.coverUrl && !meta.title) {
      return null;
    }
    return meta;
  } catch (err) {
    console.warn("Failed to extract ID3 metadata:", err);
  }
  return null;
}

/** @deprecated use getID3Metadata — kept for call sites expecting cover only */
export async function getID3CoverUrl(url: string): Promise<{ url: string; blob: Blob } | null> {
  const meta = await getID3Metadata(url);
  if (meta?.coverUrl && meta.coverBlob) {
    return { url: meta.coverUrl, blob: meta.coverBlob };
  }
  return null;
}

/**
 * Custom React Hook to load and cache ID3 cover + text metadata dynamically
 */
export function useID3Cover(itemId: string | undefined, dbCoverUrl: string | undefined, mediaType?: string) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<ID3Metadata | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!itemId || mediaType?.startsWith("video")) {
      setCoverUrl(null);
      setMeta(null);
      return;
    }
    const activeItemId = itemId;
    if (dbCoverUrl) {
      setCoverUrl(dbCoverUrl);
    }

    if (id3MetaCache.has(activeItemId)) {
      const cached = id3MetaCache.get(activeItemId)!;
      setMeta(cached);
      if (!dbCoverUrl && cached.coverUrl) setCoverUrl(cached.coverUrl);
      return;
    }

    if (id3CoverCache.has(activeItemId) && dbCoverUrl) {
      setCoverUrl(id3CoverCache.get(activeItemId)! || dbCoverUrl);
      // still try text meta if not cached
    }

    let active = true;
    setLoading(true);

    async function extractMeta() {
      try {
        const res = await api.request<{ url: string }>(`/media/items/${activeItemId}/play-url`);
        if (!active || !res?.url) {
          setLoading(false);
          return;
        }

        const id3Data = await getID3Metadata(res.url);
        if (!active) return;

        if (id3Data) {
          id3MetaCache.set(activeItemId, id3Data);
          setMeta(id3Data);

          if (id3Data.coverUrl) {
            id3CoverCache.set(activeItemId, id3Data.coverUrl);
            if (!dbCoverUrl) setCoverUrl(id3Data.coverUrl);
          }

          // 回写歌手/专辑到服务端（空字段才写）
          if (id3Data.artist || id3Data.album) {
            try {
              await api.request(`/media/items/${activeItemId}/metadata`, {
                method: "PATCH",
                body: JSON.stringify({
                  artist: id3Data.artist || null,
                  album: id3Data.album || null,
                }),
              });
            } catch (err) {
              console.warn("Failed to patch ID3 text metadata:", err);
            }
          }

          // Upload cover to server in the background
          if (id3Data.coverBlob && !dbCoverUrl) {
            try {
              const formData = new FormData();
              formData.append("file", id3Data.coverBlob, "cover.jpg");

              const token = localStorage.getItem("super-token");
              const uploadResRaw = await fetch(`${getBaseUrl()}/media/upload-cover`, {
                method: "POST",
                body: formData,
                headers: {
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
              });

              if (uploadResRaw.ok) {
                const uploadRes = await uploadResRaw.json();
                if (uploadRes && uploadRes.url) {
                  await api.request(`/media/items/${activeItemId}/cover`, {
                    method: "PATCH",
                    body: JSON.stringify({ cover_url: uploadRes.url }),
                  });
                  id3CoverCache.set(activeItemId, uploadRes.url);
                }
              }
            } catch (err) {
              console.warn("Failed to upload ID3 cover to server:", err);
            }
          }
        } else {
          id3CoverCache.set(activeItemId, "");
          id3MetaCache.set(activeItemId, {});
          if (!dbCoverUrl) setCoverUrl(null);
        }
      } catch (e) {
        console.warn("ID3 metadata extraction hook error:", e);
      } finally {
        if (active) setLoading(false);
      }
    }

    extractMeta();
    return () => {
      active = false;
    };
  }, [itemId, dbCoverUrl]);

  return { coverUrl, loading, meta };
}

interface AudioCoverProps {
  item: {
    id: string;
    cover_url?: string;
    title?: string;
  };
  className?: string;
  fallbackIconSize?: number;
}

/** 由标题/id 派生稳定色相，无封面时作渐变底色 */
function coverHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/**
 * Drop-in component to display the audio cover (dynamically reading ID3 if DB cover is missing)
 */
export function AudioCover({ item, className, fallbackIconSize = 28 }: AudioCoverProps) {
  const { coverUrl, loading } = useID3Cover(item.id, item.cover_url, (item as any).type);
  const coverToUse = coverUrl || item.cover_url;

  if (coverToUse) {
    return (
      <img
        src={resolveAttachmentUrl(coverToUse)}
        alt={item.title || "audio cover"}
        className={cn("w-full h-full object-cover", className)}
        loading="lazy"
      />
    );
  }

  const hue = coverHue(item.title || item.id || "audio");
  const initial = (item.title || "♪").trim().charAt(0).toUpperCase() || "♪";

  // className 里常带 object-cover（给 img 用），占位容器只保留尺寸/动画相关
  const shellClass = (className || "")
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("object-"))
    .join(" ");

  return (
    <div
      className={cn(
        "w-full h-full relative flex items-center justify-center overflow-hidden select-none",
        shellClass,
      )}
      style={{
        background: `linear-gradient(145deg,
          hsl(${hue}, 48%, 52%) 0%,
          hsl(${(hue + 28) % 360}, 42%, 34%) 55%,
          hsl(${(hue + 52) % 360}, 38%, 24%) 100%)`,
      }}
      aria-hidden
    >
      {/* 柔和唱片环，避免纯灰块 */}
      <div
        className="absolute inset-[14%] rounded-full border border-white/20"
        style={{
          background:
            "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), transparent 45%), rgba(0,0,0,0.18)",
        }}
      />
      <div className="absolute inset-[42%] rounded-full bg-black/25 border border-white/10" />
      <div className="relative z-[1] flex flex-col items-center justify-center gap-0.5">
        <span
          className={cn(
            "text-white/95 font-semibold tracking-tight drop-shadow-sm leading-none",
            loading && "animate-pulse",
          )}
          style={{ fontSize: Math.max(fallbackIconSize * 0.95, 16) }}
        >
          {initial}
        </span>
        <Music
          style={{ width: fallbackIconSize * 0.55, height: fallbackIconSize * 0.55 }}
          className="text-white/70"
        />
      </div>
    </div>
  );
}
