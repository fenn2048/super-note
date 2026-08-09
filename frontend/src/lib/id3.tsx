import React, { useEffect, useState } from "react";
import { Music } from "lucide-react";
import { api, resolveAttachmentUrl, getBaseUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

// Memory cache to prevent parsing the same audio repeatedly during current session
const id3CoverCache = new Map<string, string>();
const id3MetaCache = new Map<string, ID3Metadata>();
/** In-flight parse promises so concurrent play hooks share one request per item */
const id3ParseInflight = new Map<string, Promise<ID3Metadata | null>>();
/** Listeners so list covers can react when play-time parse fills the cache */
const id3CacheListeners = new Set<() => void>();

function notifyId3CacheUpdate() {
  id3CacheListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore listener errors */
    }
  });
}

function setId3CoverCache(itemId: string, url: string) {
  id3CoverCache.set(itemId, url);
  notifyId3CacheUpdate();
}

function setId3MetaCache(itemId: string, meta: ID3Metadata) {
  id3MetaCache.set(itemId, meta);
  if (meta.coverUrl) {
    id3CoverCache.set(itemId, meta.coverUrl);
  }
  notifyId3CacheUpdate();
}

/** 同步歌词行（秒） */
export interface LyricLine {
  time: number;
  text: string;
}

export interface ID3Metadata {
  artist?: string;
  album?: string;
  title?: string;
  coverUrl?: string;
  coverBlob?: Blob;
  /** 同步歌词（SYLT 或 USLT 内嵌 LRC）；有则 UI 跟拍高亮 */
  lyrics?: LyricLine[];
  /** 无时间轴的纯文本歌词 */
  lyricsPlain?: string;
}

/**
 * 解析 LRC 文本为同步歌词行。无有效时间戳返回 null。
 * 支持 [mm:ss.xx] / [mm:ss.xxx] / [mm:ss]
 */
export function parseLrcText(raw: string): LyricLine[] | null {
  if (!raw || !raw.trim()) return null;
  const lines: LyricLine[] = [];
  // 同一行可有多个时间戳：[00:01.00][00:02.00]text
  const lineRe = /((?:\[\d{1,3}:\d{2}(?:\.\d{1,3})?\])+)\s*(.*)$/gm;
  let m: RegExpExecArray | null;
  const timeRe = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  while ((m = lineRe.exec(raw)) !== null) {
    const stampBlock = m[1];
    const text = (m[2] || "").trim();
    if (!text) continue;
    timeRe.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = timeRe.exec(stampBlock)) !== null) {
      const min = parseInt(tm[1], 10) || 0;
      const sec = parseInt(tm[2], 10) || 0;
      let frac = 0;
      if (tm[3] != null) {
        // .1 → 0.1, .12 → 0.12, .123 → 0.123
        const f = tm[3].padEnd(3, "0").slice(0, 3);
        frac = parseInt(f, 10) / 1000;
      }
      lines.push({ time: min * 60 + sec + frac, text });
    }
  }
  if (lines.length === 0) return null;
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** 当前播放时间对应的歌词行下标（最后一条 time <= t）；无匹配返回 -1 */
export function findActiveLyricIndex(lines: LyricLine[], currentTime: number): number {
  if (!lines.length) return -1;
  const t = Number.isFinite(currentTime) ? currentTime : 0;
  // 给一点提前量，避免字幕总感觉慢半拍
  const look = t + 0.05;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= look) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** 读以 encoding 终止的描述串，返回描述结束之后的偏移 */
function skipId3TerminatedString(
  buffer: Uint8Array,
  start: number,
  end: number,
  encoding: number,
): number {
  let p = start;
  if (encoding === 0 || encoding === 3) {
    // ISO-8859-1 / UTF-8：单 0 终止
    while (p < end && buffer[p] !== 0) p++;
    return Math.min(p + 1, end);
  }
  // UTF-16：双 0 终止
  while (p + 1 < end && !(buffer[p] === 0 && buffer[p + 1] === 0)) {
    p += 2;
  }
  return Math.min(p + 2, end);
}

/**
 * USLT / ULT：encoding(1) + language(3) + content descriptor + lyrics text
 */
export function readUsLTFrame(
  buffer: Uint8Array,
  frameDataOffset: number,
  frameSize: number,
): { plain: string; lines: LyricLine[] | null } | null {
  if (frameSize < 5) return null;
  const encoding = buffer[frameDataOffset];
  const end = frameDataOffset + frameSize;
  // skip language 3 bytes
  let p = frameDataOffset + 1 + 3;
  if (p >= end) return null;
  p = skipId3TerminatedString(buffer, p, end, encoding);
  if (p >= end) return null;
  const text = decodeId3Text(encoding, buffer.subarray(p, end));
  if (!text) return null;
  const lines = parseLrcText(text);
  return { plain: text, lines };
}

/**
 * SYLT / SLT：encoding + language(3) + timestampFormat + contentType + descriptor + entries
 * timestampFormat: 1=MPEG frames（无采样率时降级 plain）, 2=milliseconds
 */
export function readSYLTFrame(
  buffer: Uint8Array,
  frameDataOffset: number,
  frameSize: number,
): { plain: string; lines: LyricLine[] | null } | null {
  if (frameSize < 6) return null;
  const encoding = buffer[frameDataOffset];
  const end = frameDataOffset + frameSize;
  let p = frameDataOffset + 1 + 3; // skip language
  if (p + 2 > end) return null;
  const timestampFormat = buffer[p];
  p += 1;
  // content type
  p += 1;
  p = skipId3TerminatedString(buffer, p, end, encoding);
  if (p >= end) return null;

  const lines: LyricLine[] = [];
  const plainParts: string[] = [];

  while (p < end) {
    // sync text until terminator
    const textStart = p;
    if (encoding === 0 || encoding === 3) {
      while (p < end && buffer[p] !== 0) p++;
      const slice = buffer.subarray(textStart, p);
      const text = decodeId3Text(encoding, slice);
      p = Math.min(p + 1, end);
      // 4-byte timestamp
      if (p + 4 > end) break;
      const ts =
        ((buffer[p] << 24) | (buffer[p + 1] << 16) | (buffer[p + 2] << 8) | buffer[p + 3]) >>> 0;
      p += 4;
      if (text) {
        plainParts.push(text);
        if (timestampFormat === 2) {
          lines.push({ time: ts / 1000, text });
        }
      }
    } else {
      while (p + 1 < end && !(buffer[p] === 0 && buffer[p + 1] === 0)) {
        p += 2;
      }
      const slice = buffer.subarray(textStart, p);
      const text = decodeId3Text(encoding, slice);
      p = Math.min(p + 2, end);
      if (p + 4 > end) break;
      const ts =
        ((buffer[p] << 24) | (buffer[p + 1] << 16) | (buffer[p + 2] << 8) | buffer[p + 3]) >>> 0;
      p += 4;
      if (text) {
        plainParts.push(text);
        if (timestampFormat === 2) {
          lines.push({ time: ts / 1000, text });
        }
      }
    }
  }

  if (lines.length > 0) {
    lines.sort((a, b) => a.time - b.time);
    return { plain: plainParts.join("\n"), lines };
  }
  if (plainParts.length > 0) {
    return { plain: plainParts.join("\n"), lines: null };
  }
  return null;
}

export interface UseID3CoverOptions {
  /**
   * When true, fetch play-url and parse ID3 if not already cached.
   * Only enable while the track is the active playback target.
   * Default false: read DB cover + memory cache only (no network parse).
   */
  parse?: boolean;
}

/** Read cover from memory cache (session). Empty string means "parsed, no cover". */
export function getCachedID3Cover(itemId: string): string | undefined {
  return id3CoverCache.get(itemId);
}

/** Read full metadata from memory cache (session). */
export function getCachedID3Meta(itemId: string): ID3Metadata | undefined {
  return id3MetaCache.get(itemId);
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

      // 歌词：SYLT 优先；无同步时用 USLT（可能内嵌 LRC）
      const isSylt =
        (isV2 && frameId === "SLT") || ((isV3 || isV4) && frameId === "SYLT");
      const isUslt =
        (isV2 && frameId === "ULT") || ((isV3 || isV4) && frameId === "USLT");

      if (isSylt && !meta.lyrics) {
        const sylt = readSYLTFrame(buffer, frameDataOffset, frameSize);
        if (sylt?.lines && sylt.lines.length > 0) {
          meta.lyrics = sylt.lines;
          if (sylt.plain) meta.lyricsPlain = sylt.plain;
        } else if (sylt?.plain && !meta.lyricsPlain) {
          meta.lyricsPlain = sylt.plain;
        }
      }

      if (isUslt && !meta.lyrics) {
        const uslt = readUsLTFrame(buffer, frameDataOffset, frameSize);
        if (uslt?.lines && uslt.lines.length > 0) {
          meta.lyrics = uslt.lines;
          if (uslt.plain) meta.lyricsPlain = uslt.plain;
        } else if (uslt?.plain && !meta.lyricsPlain) {
          meta.lyricsPlain = uslt.plain;
        }
      }

      offset += headerSize + frameSize;
    }

    if (
      !meta.artist &&
      !meta.album &&
      !meta.coverUrl &&
      !meta.title &&
      !meta.lyrics &&
      !meta.lyricsPlain
    ) {
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
 * Resolve display cover: session ID3 (blob/uploaded) first, then DB cover_url.
 * ID3-first so APIC art wins over a missing/stale DB field while the track is playing.
 */
function resolveCoverFromCache(itemId: string, dbCoverUrl?: string): string | null {
  const cached = id3CoverCache.get(itemId);
  // empty string = parsed, no cover — fall through to DB if any
  if (cached) return cached;
  const meta = id3MetaCache.get(itemId);
  if (meta?.coverUrl) return meta.coverUrl;
  if (dbCoverUrl) return dbCoverUrl;
  return null;
}

/**
 * Parse ID3 once per item (deduped). Writes session cache; optionally uploads cover
 * and patches artist/album when DB fields are empty.
 */
async function ensureID3Parsed(
  itemId: string,
  dbCoverUrl: string | undefined,
): Promise<ID3Metadata | null> {
  if (id3MetaCache.has(itemId)) {
    return id3MetaCache.get(itemId)!;
  }

  const inflight = id3ParseInflight.get(itemId);
  if (inflight) return inflight;

  const promise = (async (): Promise<ID3Metadata | null> => {
    try {
      const res = await api.request<{ url: string }>(`/media/items/${itemId}/play-url`);
      if (!res?.url) return null;

      const id3Data = await getID3Metadata(res.url);

      if (id3Data) {
        setId3MetaCache(itemId, id3Data);

        // 回写歌手/专辑到服务端（空字段才写）
        if (id3Data.artist || id3Data.album) {
          try {
            await api.request(`/media/items/${itemId}/metadata`, {
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

        // Upload cover to server so next load can use DB cover without re-parse
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
                await api.request(`/media/items/${itemId}/cover`, {
                  method: "PATCH",
                  body: JSON.stringify({ cover_url: uploadRes.url }),
                });
                // Prefer durable server URL over blob URL in cache
                setId3CoverCache(itemId, uploadRes.url);
                const prev = id3MetaCache.get(itemId) || id3Data;
                setId3MetaCache(itemId, { ...prev, coverUrl: uploadRes.url });
              }
            }
          } catch (err) {
            console.warn("Failed to upload ID3 cover to server:", err);
          }
        }

        return id3MetaCache.get(itemId) || id3Data;
      }

      // Parsed but empty — mark so we don't re-fetch on every play
      setId3CoverCache(itemId, "");
      setId3MetaCache(itemId, {});
      return null;
    } catch (e) {
      console.warn("ID3 metadata extraction error:", e);
      return null;
    } finally {
      id3ParseInflight.delete(itemId);
    }
  })();

  id3ParseInflight.set(itemId, promise);
  return promise;
}

/**
 * Cover + ID3 metadata hook.
 *
 * - Default (`parse: false`): only DB cover_url and session cache — used by list tiles.
 * - `parse: true`: fetch & parse ID3 when not cached — only while the track is playing.
 * - After a successful parse, cover is cached in memory and uploaded to the server;
 *   subsequent displays prefer cache / DB cover without re-parsing.
 */
export function useID3Cover(
  itemId: string | undefined,
  dbCoverUrl: string | undefined,
  mediaType?: string,
  options?: UseID3CoverOptions,
) {
  const shouldParse = options?.parse === true;
  const [coverUrl, setCoverUrl] = useState<string | null>(() =>
    itemId && !mediaType?.startsWith("video") ? resolveCoverFromCache(itemId, dbCoverUrl) : null,
  );
  const [meta, setMeta] = useState<ID3Metadata | null>(() =>
    itemId && id3MetaCache.has(itemId) ? id3MetaCache.get(itemId)! : null,
  );
  const [loading, setLoading] = useState<boolean>(false);

  /**
   * 切歌时必须同步清掉上一首的 meta/cover。
   * 若只在 useEffect 里清，会有一帧旧 meta 泄漏到 GlobalMusicPlayer，
   * 再被 patchCurrentMedia 写进新曲（表现为标题/封面已变、歌手专辑仍是上一首）。
   */
  const [boundItemId, setBoundItemId] = useState(itemId);
  if (boundItemId !== itemId) {
    setBoundItemId(itemId);
    if (!itemId || mediaType?.startsWith("video")) {
      setCoverUrl(null);
      setMeta(null);
      setLoading(false);
    } else {
      setCoverUrl(resolveCoverFromCache(itemId, dbCoverUrl));
      setMeta(id3MetaCache.has(itemId) ? id3MetaCache.get(itemId)! : null);
      setLoading(false);
    }
  }

  // Keep display state in sync with DB cover + session cache (incl. play-time fills)
  useEffect(() => {
    if (!itemId || mediaType?.startsWith("video")) {
      setCoverUrl(null);
      setMeta(null);
      return;
    }

    const syncFromCache = () => {
      setCoverUrl(resolveCoverFromCache(itemId, dbCoverUrl));
      // 无缓存时必须置 null，禁止保留上一首歌的歌手/专辑
      setMeta(id3MetaCache.has(itemId) ? id3MetaCache.get(itemId)! : null);
    };

    syncFromCache();
    id3CacheListeners.add(syncFromCache);
    return () => {
      id3CacheListeners.delete(syncFromCache);
    };
  }, [itemId, dbCoverUrl, mediaType]);

  // Parse only when explicitly requested (audio playback)
  useEffect(() => {
    if (!shouldParse || !itemId || mediaType?.startsWith("video")) {
      setLoading(false);
      return;
    }

    if (id3MetaCache.has(itemId)) {
      setMeta(id3MetaCache.get(itemId)!);
      setCoverUrl(resolveCoverFromCache(itemId, dbCoverUrl));
      setLoading(false);
      return;
    }

    // 解析前先清空，避免异步返回前 UI / patch 仍用旧 meta
    setMeta(null);
    setCoverUrl(resolveCoverFromCache(itemId, dbCoverUrl));

    let active = true;
    setLoading(true);

    ensureID3Parsed(itemId, dbCoverUrl).then((id3Data) => {
      if (!active) return;
      if (id3Data) {
        setMeta(id3Data);
        setCoverUrl(resolveCoverFromCache(itemId, dbCoverUrl));
      } else if (!dbCoverUrl) {
        setCoverUrl(null);
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [itemId, dbCoverUrl, mediaType, shouldParse]);

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
  /**
   * Explicit cover URL (e.g. already-resolved ID3 blob from the playing track).
   * Wins over cache / DB so fullscreen player can share one source with the blur backdrop.
   */
  src?: string | null;
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
 * Drop-in component to display the audio cover.
 * Prefers optional `src` override, then DB cover_url / session ID3 cache.
 * Does not parse ID3 (parsing happens on play via useID3Cover parse:true).
 */
export function AudioCover({ item, className, fallbackIconSize = 28, src }: AudioCoverProps) {
  const { coverUrl, loading } = useID3Cover(item.id, item.cover_url, (item as any).type, {
    parse: false,
  });
  const coverToUse = (src && src.length > 0 ? src : null) || coverUrl || item.cover_url || null;

  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [coverToUse, item.id]);

  if (coverToUse && !imgFailed) {
    return (
      <img
        src={
          coverToUse.startsWith("blob:") ||
          coverToUse.startsWith("data:") ||
          (coverToUse.startsWith("/") && !coverToUse.startsWith("/api"))
            ? coverToUse // blob / data / 本地静态资源（如 /default_audio_cover.jpg）
            : resolveAttachmentUrl(coverToUse)
        }
        alt={item.title || "audio cover"}
        className={cn("w-full h-full object-cover", className)}
        loading="lazy"
        onError={() => setImgFailed(true)}
      />
    );
  }

  const hue = coverHue(item.title || item.id || "audio");

  // className 里常带 object-cover（给 img 用），占位容器只保留尺寸/动画相关
  const shellClass = (className || "")
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("object-"))
    .join(" ");

  // 无 ID3/DB 封面：渐变唱片盘 + 音符（不显示歌名首字）
  return (
    <div
      className={cn(
        "w-full h-full relative flex items-center justify-center overflow-hidden select-none",
        loading && "animate-pulse",
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
      <div
        className="absolute inset-[14%] rounded-full border border-white/20"
        style={{
          background:
            "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), transparent 45%), rgba(0,0,0,0.18)",
        }}
      />
      <div className="absolute inset-[42%] rounded-full bg-black/25 border border-white/10" />
      <Music
        style={{ width: fallbackIconSize, height: fallbackIconSize }}
        className="relative z-[1] text-white/80"
      />
    </div>
  );
}
