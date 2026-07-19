/**
 * 移动壳层规则单元测试
 */
import { describe, expect, it } from "vitest";
import {
  shouldShowMobileTabBar,
  shouldShowMobileFAB,
  isLibraryStackViewMode,
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
});
