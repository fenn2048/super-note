export function calculateRemindAt(dueDateStr: string | null, offsetValue: number, offsetUnit: string): string | null {
  if (!dueDateStr) return null;
  const isIso = dueDateStr.includes("T") || dueDateStr.includes("Z");
  const hasTime = dueDateStr.includes(" ") || dueDateStr.includes("T");

  let dueTime = new Date(dueDateStr).getTime();
  if (isNaN(dueTime)) return null;

  const date = new Date(dueTime);

  switch (offsetUnit) {
    case 'minute':
      date.setMinutes(date.getMinutes() - offsetValue);
      break;
    case 'hour':
      date.setHours(date.getHours() - offsetValue);
      break;
    case 'day':
      date.setDate(date.getDate() - offsetValue);
      break;
    case 'month':
      date.setMonth(date.getMonth() - offsetValue);
      break;
    case 'year':
      date.setFullYear(date.getFullYear() - offsetValue);
      break;
    default:
      date.setDate(date.getDate() - offsetValue);
      break;
  }

  if (isIso) {
    return date.toISOString();
  } else if (hasTime) {
    const yyyy = date.getFullYear();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
  } else {
    const yyyy = date.getFullYear();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd}`;
  }
}
