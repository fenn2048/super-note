import { describe, expect, it } from "vitest";
import { withMediaWidth } from "@/lib/api";

describe("withMediaWidth", () => {
  it("appends w= on a clean url", () => {
    expect(withMediaWidth("/emojis/pack/a.gif", 240)).toBe("/emojis/pack/a.gif?w=240");
  });

  it("appends with & when query already exists", () => {
    expect(withMediaWidth("/api/im/stickers/id?token=x", 240)).toBe(
      "/api/im/stickers/id?token=x&w=240",
    );
  });

  it("is idempotent if w= is already present", () => {
    expect(withMediaWidth("/emojis/pack/a.gif?w=240", 480)).toBe("/emojis/pack/a.gif?w=240");
  });

  it("returns empty string for empty input", () => {
    expect(withMediaWidth("")).toBe("");
  });
});
