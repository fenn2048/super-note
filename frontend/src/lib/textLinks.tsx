/**
 * 说说 / 聊天正文里的 http(s) 超链接：
 *   - 纯文本拆成可点的 <a>
 *   - 渲染后的 HTML 补 target=_blank
 *   - 点击走 openExternalUrl（Web 新标签；Android 系统浏览器）
 */
import React from "react";
import { openExternalUrl } from "@/lib/downloadFile";

/** 与 `.diary-rendered-content a` 共用样式（见 index.css） */
export const CONTENT_HTTP_LINK_CLASS = "content-http-link";

const HTTP_URL_RE = /https?:\/\/[^\s<>"'`\\]+/gi;
const MD_OR_BARE_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;

export function isHttpUrl(href: string): boolean {
  const v = (href || "").trim();
  return /^(https?:)?\/\//i.test(v);
}

export function peelTrailingPunctuation(raw: string): { url: string; trailing: string } {
  let url = raw;
  let trailing = "";
  while (url) {
    const last = url[url.length - 1];
    if (!/[),.;:!?，。；：！？、'"”’>\]]/.test(last)) break;
    if (last === ")") {
      const open = (url.match(/\(/g) || []).length;
      const close = (url.match(/\)/g) || []).length;
      if (open >= close) break;
    }
    trailing = last + trailing;
    url = url.slice(0, -1);
  }
  return { url, trailing };
}

export type TextUrlToken =
  | { kind: "text"; value: string }
  | { kind: "url"; url: string; trailing: string };

export function splitTextUrls(text: string): TextUrlToken[] {
  if (!text) return [];
  const out: TextUrlToken[] = [];
  const re = new RegExp(HTTP_URL_RE.source, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) });
    const peeled = peelTrailingPunctuation(m[0]);
    if (peeled.url) out.push({ kind: "url", ...peeled });
    else out.push({ kind: "text", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out.length ? out : [{ kind: "text", value: text }];
}

export function openHttpUrl(href: string): void {
  if (!href) return;
  const url = href.startsWith("//") ? `https:${href}` : href;
  openExternalUrl(url);
}

/** 拦截容器内 <a href="http(s)://…"> 点击，新标签 / 系统浏览器打开。 */
export function handleHttpLinkClick(e: {
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}): boolean {
  const el = e.target as HTMLElement | null;
  const a = el?.closest?.("a");
  if (!a) return false;
  const href = a.getAttribute("href") || "";
  if (!isHttpUrl(href)) return false;
  e.preventDefault();
  e.stopPropagation();
  openHttpUrl(href);
  return true;
}

export function preventAndOpenHttpUrl(
  href: string,
  e: { preventDefault: () => void; stopPropagation: () => void },
  opts?: { disabled?: boolean },
): void {
  e.preventDefault();
  e.stopPropagation();
  if (opts?.disabled) return;
  openHttpUrl(href);
}

/** 给 HTML 里的 http(s) 链接补 target=_blank，内部协议（book:// 等）不动。 */
export function ensureHtmlLinksOpenInNewTab(html: string): string {
  if (!html || typeof document === "undefined") return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!isHttpUrl(href)) return;
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

function HttpAnchor({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={CONTENT_HTTP_LINK_CLASS}
      onClick={(e) => preventAndOpenHttpUrl(href, e)}
    >
      {children}
    </a>
  );
}

/** 说说评论 / 讨论：Markdown 链接 + 裸 URL。 */
export function renderTextWithLinks(text: string): React.ReactNode {
  if (!text) return "";
  const parts: React.ReactNode[] = [];
  const re = new RegExp(MD_OR_BARE_LINK_RE.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    if (match[1] && match[2]) {
      parts.push(
        <HttpAnchor key={match.index} href={match[2]}>
          {match[1]}
        </HttpAnchor>,
      );
    } else if (match[3]) {
      const peeled = peelTrailingPunctuation(match[3]);
      parts.push(
        <HttpAnchor key={match.index} href={peeled.url}>
          {peeled.url}
        </HttpAnchor>,
      );
      if (peeled.trailing) parts.push(peeled.trailing);
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}
