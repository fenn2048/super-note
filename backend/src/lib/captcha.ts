import { v4 as uuid } from "uuid";

// Transient in-memory store for CAPTCHAs, with 10-minute expiry
const captchaStore = new Map<string, { code: string; expiresAt: number }>();

function cleanExpiredCaptchas() {
  const now = Date.now();
  for (const [id, data] of captchaStore.entries()) {
    if (data.expiresAt < now) {
      captchaStore.delete(id);
    }
  }
}

export function generateCaptcha(): { id: string; svg: string } {
  cleanExpiredCaptchas();

  // Create a 4-character alphanumeric code, avoiding easily confused letters/numbers
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  const width = 120;
  const height = 40;
  
  // Noise lines
  let lines = "";
  for (let i = 0; i < 4; i++) {
    const x1 = Math.floor(Math.random() * width);
    const y1 = Math.floor(Math.random() * height);
    const x2 = Math.floor(Math.random() * width);
    const y2 = Math.floor(Math.random() * height);
    const color = `rgb(${Math.floor(Math.random() * 150)}, ${Math.floor(Math.random() * 150)}, ${Math.floor(Math.random() * 150)})`;
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${1 + Math.random() * 1.5}" opacity="0.5" />`;
  }

  // Noise points
  let points = "";
  for (let i = 0; i < 20; i++) {
    const cx = Math.floor(Math.random() * width);
    const cy = Math.floor(Math.random() * height);
    const r = 1 + Math.random() * 1;
    const color = `rgb(${Math.floor(Math.random() * 180)}, ${Math.floor(Math.random() * 180)}, ${Math.floor(Math.random() * 180)})`;
    points += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.4" />`;
  }

  // Render characters with slight rotation/transform
  let textElements = "";
  const dx = width / (code.length + 1);
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const x = dx * (i + 0.6) + (Math.random() - 0.5) * 4;
    const y = height / 2 + 5 + (Math.random() - 0.5) * 4;
    const angle = (Math.random() - 0.5) * 30; // -15 to +15 deg
    const color = `rgb(${Math.floor(Math.random() * 100)}, ${Math.floor(Math.random() * 100)}, ${Math.floor(Math.random() * 100)})`;
    const fontSize = 20 + Math.floor(Math.random() * 4);
    const fontWeight = Math.random() > 0.5 ? "bold" : "normal";
    textElements += `<text x="${x}" y="${y}" fill="${color}" font-size="${fontSize}" font-family="monospace, sans-serif" font-weight="${fontWeight}" transform="rotate(${angle}, ${x}, ${y})">${char}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background-color: #f3f4f6; border-radius: 6px; user-select: none;">
    ${lines}
    ${points}
    ${textElements}
  </svg>`;

  const id = uuid();
  // 10 minutes expiry
  captchaStore.set(id, { code, expiresAt: Date.now() + 10 * 60 * 1000 });

  return { id, svg };
}

export function verifyCaptcha(id: string, text: string): boolean {
  cleanExpiredCaptchas();
  if (!id || !text) return false;
  const entry = captchaStore.get(id);
  if (!entry) return false;
  
  // Single use: delete after retrieval/check
  captchaStore.delete(id);

  if (entry.expiresAt < Date.now()) return false;
  
  return entry.code.toLowerCase() === text.trim().toLowerCase();
}
