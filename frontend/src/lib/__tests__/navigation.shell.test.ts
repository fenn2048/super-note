/**
 * 移动壳层规则单元测试
 */
import { describe, expect, it } from "vitest";
import {
  shouldShowMobileTabBar,
  shouldShowMobileFAB,
  shouldShowDesktopFAB,
  isLibraryStackViewMode,
  getMobileTabModules,
  getMobileMoreModules,
  isChatTabActive,
  parseBookReaderHash,
} from "@/lib/navigation.config";

describe("mobile shell rules", () => {
  it("library is stack — no tab bar / fab", () => {
    expect(isLibraryStackViewMode("library")).toBe(true);
    expect(shouldShowMobileTabBar({ viewMode: "library" })).toBe(false);
    expect(shouldShowMobileFAB({ viewMode: "library" })).toBe(false);
  });

  it("notes list shows tab + fab", () => {
    expect(
      shouldShowMobileTabBar({ viewMode: "all", mobileView: "list" }),
    ).toBe(true);
    expect(
      shouldShowMobileFAB({ viewMode: "all", mobileView: "list" }),
    ).toBe(true);
  });

  it("notes editor hides tab bar", () => {
    expect(
      shouldShowMobileTabBar({ viewMode: "all", mobileView: "editor" }),
    ).toBe(false);
  });

  it("more shows tab but not fab", () => {
    expect(shouldShowMobileTabBar({ viewMode: "more" })).toBe(true);
    expect(shouldShowMobileFAB({ viewMode: "more" })).toBe(false);
  });

  it("project detail hides tab bar", () => {
    expect(
      shouldShowMobileTabBar({
        viewMode: "projects",
        isProjectDetailOpen: true,
      }),
    ).toBe(false);
  });

  it("settings route hides tab bar and fab", () => {
    expect(shouldShowMobileTabBar({ viewMode: "settings" })).toBe(false);
    expect(shouldShowMobileFAB({ viewMode: "settings" })).toBe(false);
  });

  it("chat list shows tab bar but not fab; thread hides both", () => {
    expect(shouldShowMobileTabBar({ viewMode: "chat" })).toBe(true);
    expect(shouldShowMobileFAB({ viewMode: "chat" })).toBe(false);
    expect(
      shouldShowMobileTabBar({ viewMode: "chat", isChatThreadOpen: true }),
    ).toBe(false);
    expect(
      shouldShowMobileFAB({ viewMode: "chat", isChatThreadOpen: true }),
    ).toBe(false);
  });

  it("diary from chat still shows tab + fab", () => {
    expect(shouldShowMobileTabBar({ viewMode: "diary" })).toBe(true);
    expect(shouldShowMobileFAB({ viewMode: "diary" })).toBe(true);
  });
});

describe("shouldShowDesktopFAB", () => {
  it("shows by default on desktop shell", () => {
    expect(shouldShowDesktopFAB({})).toBe(true);
  });

  it("hides while reading a book", () => {
    expect(shouldShowDesktopFAB({ isBookReading: true })).toBe(false);
  });

  it("hides in media theater / lights-out mode", () => {
    expect(shouldShowDesktopFAB({ isMediaTheater: true })).toBe(false);
  });

  it("hides when explicitly blocked", () => {
    expect(shouldShowDesktopFAB({ blocked: true })).toBe(false);
  });

  it("hides on finance and health modules", () => {
    expect(shouldShowDesktopFAB({ viewMode: "finance" })).toBe(false);
    expect(shouldShowDesktopFAB({ viewMode: "health" })).toBe(false);
    expect(shouldShowDesktopFAB({ viewMode: "all" })).toBe(true);
  });
});

describe("parseBookReaderHash", () => {
  it("reads #/books/<hash>", () => {
    expect(parseBookReaderHash("#/books/abc123")).toBe("abc123");
    expect(parseBookReaderHash("#/books/")).toBeNull();
    expect(parseBookReaderHash("#/library")).toBeNull();
  });
});

describe("isModuleActive", () => {
  it("highlights notes for notebook views; home is own tab; notes under more", async () => {
    const { isModuleActive } = await import("@/lib/navigation.config");
    expect(isModuleActive("notes", "all")).toBe(true);
    expect(isModuleActive("notes", "favorites")).toBe(true);
    expect(isModuleActive("tasks", "projects")).toBe(true);
    // 首页独立底栏 Tab，不再高亮「我的」
    expect(isModuleActive("home", "home")).toBe(true);
    expect(isModuleActive("more", "home")).toBe(false);
    // 笔记改入「我的」后，笔记/收藏二级页高亮我的
    expect(isModuleActive("more", "all")).toBe(true);
    expect(isModuleActive("more", "favorites")).toBe(true);
    // 说说从聊天顶栏进入，高亮聊天而非「我的」
    expect(isModuleActive("more", "diary")).toBe(false);
    expect(isModuleActive("more", "chat")).toBe(false);
    expect(isModuleActive("chat", "chat")).toBe(true);
    expect(isModuleActive("chat", "diary")).toBe(false);
    expect(isChatTabActive("chat")).toBe(true);
    expect(isChatTabActive("diary")).toBe(true);
    expect(isChatTabActive("more")).toBe(false);
  });

  it("mobile tabs are home / tasks / chat; diary is not in more", () => {
    const tabs = getMobileTabModules(null).map((m) => m.id);
    const more = getMobileMoreModules(null).map((m) => m.id);
    expect(tabs).toEqual(["home", "tasks", "chat"]);
    expect(more).not.toContain("diary");
    expect(more).toContain("notes");
    expect(more).not.toContain("chat");
  });
});
