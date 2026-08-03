/**
 * Re-export: calendar package lives under ./calendar/
 * Keep this path stable for ProjectCenter and other imports.
 */
export { default } from "./calendar/ProjectCalendar";
export type { ProjectCalendarProps, CalendarViewMode } from "./calendar/types";
