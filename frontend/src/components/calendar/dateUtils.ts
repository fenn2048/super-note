/** Local calendar day string YYYY-MM-DD (avoid UTC shift from toISOString). */
export function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function taskDateOnly(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return toLocalYmd(d);
}

export function extractTimeHm(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const m = s.trim().match(/(?:T| )(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toLocalYmd(dt);
}

export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd).getTime();
  const b = new Date(ty, tm - 1, td).getTime();
  return Math.round((b - a) / 86400000);
}

export function shiftFieldByDays(field: string | null | undefined, dayDelta: number): string | null {
  if (!field || dayDelta === 0) return field ?? null;
  const datePart = taskDateOnly(field);
  if (!datePart) return field;
  const newDate = addDaysToYmd(datePart, dayDelta);
  const timePart = extractTimeHm(field);
  return timePart ? `${newDate} ${timePart}` : newDate;
}

export function combineDateTime(ymd: string, hm: string): string {
  const time = /^\d{1,2}:\d{2}$/.test(hm.trim()) ? hm.trim() : "09:00";
  const [h, m] = time.split(":");
  return `${ymd} ${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

export function shiftWallClock(ymdHm: string, deltaMinutes: number): string {
  const m = ymdHm.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return ymdHm;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  d.setMinutes(d.getMinutes() + deltaMinutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Sunday-start week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function weekDaysFrom(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function minutesFromMidnight(hm: string | null | undefined): number | null {
  if (!hm) return null;
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 分钟数（0–1439）→ HH:mm */
export function minutesToHm(totalMins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMins)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

/** 对齐到 step 分钟（默认 15） */
export function snapMinutes(totalMins: number, step = 15): number {
  const s = Math.max(1, step);
  return Math.round(totalMins / s) * s;
}

/**
 * 任务时长（分钟）。若缺 end 或 end≤start，默认 60。
 * 跨天时按墙钟差；仅日期无时间时视为 0（全天）。
 */
export function taskDurationMinutes(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): number {
  const startHm = extractTimeHm(startDate);
  const endHm = extractTimeHm(endDate);
  if (!startHm && !endHm) return 0;
  const s = minutesFromMidnight(startHm || endHm || "09:00") ?? 9 * 60;
  const e = minutesFromMidnight(endHm || startHm || "10:00") ?? s + 60;
  if (e > s) return e - s;
  // 跨日或 end≤start：用完整 datetime 差值
  if (startDate && endDate) {
    const a = Date.parse(startDate.replace(" ", "T"));
    const b = Date.parse(endDate.replace(" ", "T"));
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return Math.round((b - a) / 60000);
    }
  }
  return 60;
}

/** 把 field 的日期/时间换成新 ymd + 可选 hm；无 hm 则保留原时刻或仅日期 */
export function replaceDateKeepingTime(
  field: string | null | undefined,
  ymd: string,
  hm?: string | null,
): string {
  const time = hm || extractTimeHm(field);
  return time ? combineDateTime(ymd, time) : ymd;
}

/** Default short slot for create: snap today to next half-hour, else 09:00–10:00. */
export function defaultSlotForYmd(ymd: string): { start: string; end: string } {
  const now = new Date();
  if (toLocalYmd(now) === ymd) {
    const totalMins = now.getHours() * 60 + now.getMinutes();
    const snapped = Math.ceil(totalMins / 30) * 30;
    const endTotal = snapped + 60;
    return {
      start: `${pad2(Math.floor(snapped / 60) % 24)}:${pad2(snapped % 60)}`,
      end: `${pad2(Math.floor(endTotal / 60) % 24)}:${pad2(endTotal % 60)}`,
    };
  }
  return { start: "09:00", end: "10:00" };
}

export function buildMonthCells(year: number, month: number): { date: Date; isCurrentMonth: boolean }[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const cells: { date: Date; isCurrentMonth: boolean }[] = [];

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, prevMonthDays - i), isCurrentMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) {
    cells.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
  }
  return cells;
}
