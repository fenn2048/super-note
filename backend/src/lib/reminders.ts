/**
 * Task due/remind datetime helpers.
 *
 * Storage convention (wall-clock, no bare UTC ISO for business dates):
 * - date-only:  "YYYY-MM-DD"
 * - with time:  "YYYY-MM-DD HH:mm"
 *
 * Input still accepts ISO (T/Z) and space-separated forms for backward compatibility.
 */

export type TaskDateParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  hasTime: boolean;
};

/** Parse task datetime strings into local calendar parts. */
export function parseTaskDateTime(input: string | null | undefined): TaskDateParts | null {
  if (!input || typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;

  // Pure date: YYYY-MM-DD
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (!isValidYmd(year, month, day)) return null;
    return { year, month, day, hour: 0, minute: 0, hasTime: false };
  }

  // Local wall clock: YYYY-MM-DD HH:mm[:ss]
  const localDt = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (localDt && !s.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    const year = Number(localDt[1]);
    const month = Number(localDt[2]);
    const day = Number(localDt[3]);
    const hour = Number(localDt[4]);
    const minute = Number(localDt[5]);
    if (!isValidYmd(year, month, day) || hour > 23 || minute > 59) return null;
    return { year, month, day, hour, minute, hasTime: true };
  }

  // ISO / other Date-parseable forms → convert to local parts
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    hasTime: s.includes("T") || s.includes(" ") || s.includes("Z"),
  };
}

export function taskDatePartsToDate(parts: TaskDateParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
}

/** Format as local wall-clock string (never bare UTC ISO). */
export function formatTaskDateTime(date: Date, withTime: boolean): string {
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  if (!withTime) return `${yyyy}-${MM}-${dd}`;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Compute remindAt = dueDate - offset, returned in local wall-clock format.
 * Date-only due dates keep date-only result; timed due dates keep HH:mm.
 */
export function calculateRemindAt(
  dueDateStr: string | null,
  offsetValue: number,
  offsetUnit: string,
): string | null {
  if (!dueDateStr) return null;
  const parts = parseTaskDateTime(dueDateStr);
  if (!parts) return null;

  const date = taskDatePartsToDate(parts);
  const n = Number(offsetValue) || 0;

  switch (offsetUnit) {
    case "minute":
      date.setMinutes(date.getMinutes() - n);
      break;
    case "hour":
      date.setHours(date.getHours() - n);
      break;
    case "day":
      date.setDate(date.getDate() - n);
      break;
    case "month":
      date.setMonth(date.getMonth() - n);
      break;
    case "year":
      date.setFullYear(date.getFullYear() - n);
      break;
    default:
      date.setDate(date.getDate() - n);
      break;
  }

  // If source was date-only and offset is whole days/months/years, keep date-only
  // unless sub-day offset was used (hour/minute) — then include time.
  const withTime =
    parts.hasTime || offsetUnit === "hour" || offsetUnit === "minute";
  return formatTaskDateTime(date, withTime);
}
