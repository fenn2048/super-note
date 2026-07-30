import { describe, expect, it, beforeEach } from "vitest";
import {
  clampDailyReadingGoal,
  remainingGoalMinutes,
  goalProgressRatio,
  formatReadingClock,
  DEFAULT_DAILY_READING_GOAL_MINUTES,
  addTodayReadingSeconds,
  getTodayReadingMinutes,
  setCachedDailyReadingGoal,
  getCachedDailyReadingGoal,
  parseGoalFromPrefs,
} from "@/lib/readingGoal";

describe("readingGoal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clamps goal minutes", () => {
    expect(clampDailyReadingGoal(120)).toBe(120);
    expect(clampDailyReadingGoal(1)).toBe(5);
    expect(clampDailyReadingGoal(9999)).toBe(600);
    expect(clampDailyReadingGoal(NaN)).toBe(DEFAULT_DAILY_READING_GOAL_MINUTES);
  });

  it("remaining and progress", () => {
    expect(remainingGoalMinutes(0, 120)).toBe(120);
    expect(remainingGoalMinutes(30.2, 120)).toBe(90);
    expect(remainingGoalMinutes(200, 120)).toBe(0);
    expect(goalProgressRatio(60, 120)).toBe(0.5);
    expect(goalProgressRatio(200, 120)).toBe(1);
  });

  it("formats clock", () => {
    expect(formatReadingClock(0)).toBe("0:00");
    expect(formatReadingClock(5)).toBe("0:05");
    expect(formatReadingClock(65)).toBe("1:05");
    expect(formatReadingClock(120.9)).toBe("2:00");
  });

  it("accumulates today seconds into minutes", () => {
    expect(getTodayReadingMinutes("u1")).toBe(0);
    addTodayReadingSeconds(90, "u1");
    expect(getTodayReadingMinutes("u1")).toBe(1.5);
    addTodayReadingSeconds(30, "u1");
    expect(getTodayReadingMinutes("u1")).toBe(2);
  });

  it("caches goal in localStorage", () => {
    expect(getCachedDailyReadingGoal()).toBe(DEFAULT_DAILY_READING_GOAL_MINUTES);
    setCachedDailyReadingGoal(90);
    expect(getCachedDailyReadingGoal()).toBe(90);
  });

  it("parses prefs", () => {
    expect(parseGoalFromPrefs({})).toBe(null);
    expect(parseGoalFromPrefs({ dailyReadingGoalMinutes: 45 })).toBe(45);
    expect(parseGoalFromPrefs({ dailyReadingGoalMinutes: "30" })).toBe(30);
  });
});
