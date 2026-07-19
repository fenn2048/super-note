/**
 * modulePack 单元测试
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  getModulePack,
  setModulePack,
  isModuleAllowedByPack,
} from "@/lib/modulePack";

const KEY = "fuyou.module-pack";

beforeEach(() => {
  localStorage.removeItem(KEY);
});

describe("modulePack", () => {
  it("defaults to full", () => {
    expect(getModulePack()).toBe("full");
  });

  it("setModulePack persists and dispatches", () => {
    let fired = false;
    const handler = () => {
      fired = true;
    };
    window.addEventListener("super:module-pack-changed", handler);
    setModulePack("minimal");
    window.removeEventListener("super:module-pack-changed", handler);
    expect(getModulePack()).toBe("minimal");
    expect(fired).toBe(true);
  });

  it("minimal blocks tasks and diary", () => {
    expect(isModuleAllowedByPack("notes", "minimal")).toBe(true);
    expect(isModuleAllowedByPack("tasks", "minimal")).toBe(false);
    expect(isModuleAllowedByPack("diary", "minimal")).toBe(false);
    expect(isModuleAllowedByPack("library", "minimal")).toBe(true);
  });

  it("library children allowed when library in pack", () => {
    expect(isModuleAllowedByPack("books", "creator")).toBe(true);
    expect(isModuleAllowedByPack("media", "creator")).toBe(true);
  });

  it("full pack allows everything", () => {
    expect(isModuleAllowedByPack("tasks", "full")).toBe(true);
    expect(isModuleAllowedByPack("ai", "full")).toBe(true);
  });
});
