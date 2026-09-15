import { describe, expect, it, vi } from "vitest";
import {
  ensureHtmlLinksOpenInNewTab,
  handleHttpLinkClick,
  isHttpUrl,
  peelTrailingPunctuation,
  splitTextUrls,
} from "@/lib/textLinks";

vi.mock("@/lib/downloadFile", () => ({
  openExternalUrl: vi.fn(),
}));

import { openExternalUrl } from "@/lib/downloadFile";

describe("isHttpUrl", () => {
  it("accepts http(s) and protocol-relative URLs", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://localhost:3001/x")).toBe(true);
    expect(isHttpUrl("//cdn.example.com/a")).toBe(true);
  });

  it("rejects internal and relative hrefs", () => {
    expect(isHttpUrl("/api/files/1")).toBe(false);
    expect(isHttpUrl("#section")).toBe(false);
    expect(isHttpUrl("book://abc")).toBe(false);
    expect(isHttpUrl("mailto:a@b.c")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("peelTrailingPunctuation", () => {
  it("strips trailing Chinese/English punctuation", () => {
    expect(peelTrailingPunctuation("https://a.com。")).toEqual({
      url: "https://a.com",
      trailing: "。",
    });
    expect(peelTrailingPunctuation("https://a.com.")).toEqual({
      url: "https://a.com",
      trailing: ".",
    });
  });

  it("keeps balanced closing parens that belong to the URL", () => {
    expect(peelTrailingPunctuation("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual({
      url: "https://en.wikipedia.org/wiki/Foo_(bar)",
      trailing: "",
    });
  });

  it("strips an extra unmatched closing paren", () => {
    expect(peelTrailingPunctuation("https://a.com)")).toEqual({
      url: "https://a.com",
      trailing: ")",
    });
  });
});

describe("splitTextUrls", () => {
  it("returns a single text token when there is no URL", () => {
    expect(splitTextUrls("hello @bob")).toEqual([{ kind: "text", value: "hello @bob" }]);
  });

  it("splits a bare URL out of surrounding text", () => {
    expect(splitTextUrls("看这个 https://example.com/path?q=1 好了")).toEqual([
      { kind: "text", value: "看这个 " },
      { kind: "url", url: "https://example.com/path?q=1", trailing: "" },
      { kind: "text", value: " 好了" },
    ]);
  });

  it("does not swallow trailing punctuation into the href", () => {
    const tokens = splitTextUrls("链接：https://example.com。");
    expect(tokens).toEqual([
      { kind: "text", value: "链接：" },
      { kind: "url", url: "https://example.com", trailing: "。" },
    ]);
  });
});

describe("ensureHtmlLinksOpenInNewTab", () => {
  it("adds target=_blank to GFM autolinked URLs", async () => {
    const { marked } = await import("marked");
    marked.setOptions({ gfm: true, breaks: true });
    const html = ensureHtmlLinksOpenInNewTab(
      marked.parse("见 https://example.com/path") as string,
    );
    expect(html).toContain('href="https://example.com/path"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("adds target=_blank to http(s) anchors", () => {
    const html = ensureHtmlLinksOpenInNewTab('<p>go <a href="https://example.com">ex</a></p>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.com"');
  });

  it("leaves book:// and relative links alone", () => {
    const html = ensureHtmlLinksOpenInNewTab(
      '<a href="book://abc">book</a><a href="/notes/1">note</a>',
    );
    expect(html).not.toContain('target="_blank"');
  });
});

describe("handleHttpLinkClick", () => {
  it("opens http links and stops the event", async () => {
    const a = document.createElement("a");
    a.setAttribute("href", "https://example.com/x");
    const child = document.createElement("span");
    a.appendChild(child);

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const handled = handleHttpLinkClick({
      target: child,
      preventDefault,
      stopPropagation,
    });

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/x");
  });

  it("ignores non-http anchors", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "book://hash");
    const preventDefault = vi.fn();
    const handled = handleHttpLinkClick({
      target: a,
      preventDefault,
      stopPropagation: vi.fn(),
    });
    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
