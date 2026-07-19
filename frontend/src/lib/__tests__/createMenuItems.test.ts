/**
 * CreateMenu 模块包过滤
 */
import { describe, expect, it } from "vitest";
import { filterCreateMenuItems } from "@/lib/createMenuItems";

describe("filterCreateMenuItems", () => {
  it("full pack shows note/diary/task (+ camera)", () => {
    const items = filterCreateMenuItems({ pack: "full", showCamera: true });
    expect(items.map((i) => i.key)).toEqual([
      "note",
      "diary",
      "task",
      "camera",
    ]);
  });

  it("minimal pack hides diary and task", () => {
    const items = filterCreateMenuItems({ pack: "minimal", showCamera: false });
    expect(items.map((i) => i.key)).toEqual(["note"]);
  });

  it("family pack keeps diary and task without camera", () => {
    const items = filterCreateMenuItems({ pack: "family", showCamera: false });
    expect(items.map((i) => i.key)).toEqual(["note", "diary", "task"]);
  });
});
