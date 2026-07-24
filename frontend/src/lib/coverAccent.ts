/**
 * 从封面图采样主色，供全屏播放器控件着色（进度拇指 / 播放钮 / 音量拇指）。
 * 失败时返回 null，由调用方回落到主题 accent 或标题派生色。
 */

export type CoverAccent = {
  /** 控件主色，如 #7c6cf0 */
  solid: string;
  /** 柔和阴影用 rgba */
  shadow: string;
  /** 0–360 */
  hue: number;
};

/** 由标题/id 派生稳定色相（无封面或采样失败时） */
export function hueFromSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/** 无封面时的默认全屏渐变（多停靠点，偏沉浸） */
export function defaultCoverGradient(seed: string): string {
  const h = hueFromSeed(seed || "music");
  const h2 = (h + 48) % 360;
  const h3 = (h + 280) % 360;
  return `linear-gradient(155deg,
    hsl(${h} 62% 32%) 0%,
    hsl(${h2} 48% 14%) 42%,
    hsl(${h3} 55% 22%) 78%,
    hsl(${h} 40% 8%) 100%)`;
}

export function accentFromHue(hue: number): CoverAccent {
  // 控件要在深色 blur 上可读：中高饱和、中等亮度
  const solid = hslToHex(hue, 0.62, 0.58);
  const shadow = `hsla(${Math.round(hue)}, 70%, 55%, 0.35)`;
  return { solid, shadow, hue };
}

export function defaultAccentFromSeed(seed: string): CoverAccent {
  return accentFromHue(hueFromSeed(seed || "music"));
}

/**
 * 从图片 URL 提取主色（小 canvas 采样）。
 * blob/data 可直接读；跨域需 CORS 或带 token 的同源 URL。
 */
export function extractCoverAccent(src: string): Promise<CoverAccent | null> {
  if (!src || typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    // 同域 / blob 可取样；跨域需服务端 CORS（本站附件带 token 即可）
    if (!src.startsWith("blob:") && !src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    const done = (v: CoverAccent | null) => resolve(v);
    img.onload = () => {
      try {
        const size = 36;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          done(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // 按色相分桶，饱和度/明度加权，跳过近灰近黑近白
        const buckets = new Float64Array(36); // 每 10° 一桶
        const bucketS = new Float64Array(36);
        const bucketL = new Float64Array(36);
        const bucketW = new Float64Array(36);

        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 200) continue;
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          const { h, s, l } = rgbToHsl(r, g, b);
          if (s < 0.12 || l < 0.1 || l > 0.9) continue;
          // 偏好中等亮度、高饱和
          const w = s * s * (1 - Math.abs(l - 0.5) * 1.4);
          if (w <= 0) continue;
          const bi = Math.min(35, Math.floor(h / 10));
          buckets[bi] += w;
          bucketS[bi] += s * w;
          bucketL[bi] += l * w;
          bucketW[bi] += w;
        }

        let best = -1;
        let bestScore = 0;
        for (let i = 0; i < 36; i++) {
          if (buckets[i] > bestScore) {
            bestScore = buckets[i];
            best = i;
          }
        }

        if (best < 0 || bestScore < 0.01) {
          // 回退：全像素平均色（去掉极暗）
          let rr = 0;
          let gg = 0;
          let bb = 0;
          let n = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 200) continue;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r + g + b < 40) continue;
            rr += r;
            gg += g;
            bb += b;
            n++;
          }
          if (n === 0) {
            done(null);
            return;
          }
          const { h, s, l } = rgbToHsl(rr / n / 255, gg / n / 255, bb / n / 255);
          const hue = Math.round(h);
          const sat = Math.min(0.78, Math.max(0.45, s * 1.15));
          const light = Math.min(0.62, Math.max(0.48, l < 0.35 ? 0.55 : l));
          done({
            solid: hslToHex(hue, sat, light),
            shadow: `hsla(${hue}, 70%, 55%, 0.35)`,
            hue,
          });
          return;
        }

        const hue = best * 10 + 5;
        const sat = Math.min(0.82, Math.max(0.48, bucketS[best] / bucketW[best]));
        let light = bucketL[best] / bucketW[best];
        // 控件亮度夹紧，保证白图标对比
        light = Math.min(0.64, Math.max(0.48, light < 0.4 ? light + 0.18 : light));
        done({
          solid: hslToHex(hue, sat, light),
          shadow: `hsla(${Math.round(hue)}, 70%, 55%, 0.35)`,
          hue: Math.round(hue),
        });
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = src;
  });
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / d + 2) * 60;
      break;
    default:
      h = ((r - g) / d + 4) * 60;
      break;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
  } else if (hh < 120) {
    r = x;
    g = c;
  } else if (hh < 180) {
    g = c;
    b = x;
  } else if (hh < 240) {
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
