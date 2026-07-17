import React, { useEffect, useState } from "react";
import { api, resolveAttachmentUrl, getBaseUrl } from "@/lib/api";
import { Music } from "lucide-react";
import { cn } from "@/lib/utils";

// Memory cache to prevent parsing the same audio repeatedly during current session
const id3CoverCache = new Map<string, string>();

/**
 * Streaming parser that fetches up to 4MB of an audio file and extracts
 * the embedded ID3v2 cover art (PIC or APIC frames).
 */
export async function getID3CoverUrl(url: string): Promise<{ url: string, blob: Blob } | null> {
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

    while (offset < Math.min(tagSize + 10, buffer.length)) {
      let frameId = "";
      let frameSize = 0;
      let headerSize = 0;

      if (isV2) {
        frameId = String.fromCharCode(buffer[offset], buffer[offset + 1], buffer[offset + 2]);
        frameSize = (buffer[offset + 3] << 16) | (buffer[offset + 4] << 8) | buffer[offset + 5];
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

      // Check for cover image frame ("PIC" in v2, "APIC" in v3/v4)
      if ((isV2 && frameId === "PIC") || ((isV3 || isV4) && frameId === "APIC")) {
        const frameDataOffset = offset + headerSize;
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
        const blob = new Blob([imgData], { type: mimeType });
        return { url: URL.createObjectURL(blob), blob };
      }

      offset += headerSize + frameSize;
    }
  } catch (err) {
    console.warn("Failed to extract ID3 cover art:", err);
  }
  return null;
}

/**
 * Custom React Hook to load and cache ID3 cover art dynamically
 */
export function useID3Cover(itemId: string | undefined, dbCoverUrl: string | undefined, mediaType?: string) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!itemId || mediaType?.startsWith("video")) {
      setCoverUrl(null);
      return;
    }
    const activeItemId = itemId;
    if (dbCoverUrl) {
      setCoverUrl(dbCoverUrl);
      return;
    }

    if (id3CoverCache.has(activeItemId)) {
      setCoverUrl(id3CoverCache.get(activeItemId)!);
      return;
    }

    let active = true;
    setLoading(true);

    async function extractCover() {
      try {
        const res = await api.request<{ url: string }>(`/media/items/${activeItemId}/play-url`);
        if (!active || !res?.url) {
          setLoading(false);
          return;
        }

        const id3Data = await getID3CoverUrl(res.url);
        if (active) {
          if (id3Data) {
            id3CoverCache.set(activeItemId, id3Data.url);
            setCoverUrl(id3Data.url);

            // Upload cover to server in the background
            try {
              const formData = new FormData();
              formData.append("file", id3Data.blob, "cover.jpg");
              
              const token = localStorage.getItem("super-token");
              const uploadResRaw = await fetch(`${getBaseUrl()}/media/upload-cover`, {
                method: "POST",
                body: formData,
                headers: {
                  ...(token ? { Authorization: `Bearer ${token}` } : {})
                }
              });
              
              if (uploadResRaw.ok) {
                const uploadRes = await uploadResRaw.json();
                if (uploadRes && uploadRes.url) {
                  // Update the item's cover_url
                  await api.request(`/media/items/${activeItemId}/cover`, {
                    method: "PATCH",
                    body: JSON.stringify({ cover_url: uploadRes.url })
                  });
                  // Also update the in-memory cache to use the permanent URL
                  id3CoverCache.set(activeItemId, uploadRes.url);
                }
              }
            } catch (err) {
              console.warn("Failed to upload ID3 cover to server:", err);
            }

          } else {
            // Put null in cache to avoid re-fetching failed covers
            id3CoverCache.set(activeItemId, "");
            setCoverUrl(null);
          }
        }
      } catch (e) {
        console.warn("ID3 cover extraction hook error:", e);
      } finally {
        if (active) setLoading(false);
      }
    }

    extractCover();
    return () => {
      active = false;
    };
  }, [itemId, dbCoverUrl]);

  return { coverUrl, loading };
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

/**
 * Drop-in component to display the audio cover (dynamically reading ID3 if DB cover is missing)
 */
export function AudioCover({ item, className, fallbackIconSize = 20 }: AudioCoverProps) {
  const { coverUrl, loading } = useID3Cover(item.id, item.cover_url, (item as any).type);
  const coverToUse = coverUrl || item.cover_url;

  if (coverToUse) {
    return (
      <img
        src={coverToUse}
        alt={item.title || "audio cover"}
        className={cn("w-full h-full object-cover", className)}
        loading="lazy"
      />
    );
  }

  return (
    <div className={cn("w-full h-full bg-accent-primary/10 flex items-center justify-center text-accent-primary", className)}>
      <Music style={{ width: fallbackIconSize, height: fallbackIconSize }} className={loading ? "animate-pulse" : ""} />
    </div>
  );
}
