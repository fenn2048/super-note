import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, BookOpen, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 「作者感言」Modal —— 渲染 public/author-story.{zh,en}.md
 *
 * 设计思路：
 *   - 文档内容很长且会偶尔更新，但跟版本号无强绑定，所以不复用 changelog.json 那一套
 *     ——直接把同一份 Markdown 同时放在仓库根（GitHub 首页可读）和 frontend/public 下
 *     （Vite 把 public/ 原样拷到产物根，前端可 fetch 同源）。
 *   - 根据 i18n 当前语言决定加载哪一份；fetch 失败时给一条温和提示 + GitHub 兜底链接。
 *   - 一次会话内只加载一次（state 里缓存）。
 *
 * 视觉：
 *   - 整体复用「更新日志」Modal 的结构（顶部标题 + 滚动正文 + 底栏），保证「关于」面板里
 *     两个二级弹窗的观感一致。
 */

interface AuthorStoryModalProps {
  open: boolean;
  onClose: () => void;
}

function pickStoryUrl(lang: string): string {
  // 只区分中英两档：以 zh 开头算中文，其它统一走英文版
  const isZh = (lang || "").toLowerCase().startsWith("zh");
  const file = isZh ? "author-story.zh.md" : "author-story.en.md";
  // 加 ?v= 避免发版后浏览器仍然命中旧缓存
  return `/${file}?v=${encodeURIComponent(__APP_VERSION__)}`;
}

export default function AuthorStoryModal({ open, onClose }: AuthorStoryModalProps) {
  const { t, i18n } = useTranslation();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedLang, setLoadedLang] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    // 已加载且语言未变，跳过
    if (content && loadedLang === i18n.language) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(pickStoryUrl(i18n.language), { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setLoadedLang(i18n.language);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[AuthorStoryModal] load failed:", err);
        setError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, i18n.language, content, loadedLang]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const node = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[1100] flex items-center justify-center
                   bg-black/40 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 4 }}
          transition={{ duration: 0.18 }}
          className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl
                     w-full max-w-3xl max-h-[85vh] flex flex-col
                     border border-zinc-200 dark:border-zinc-800"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 顶部 */}
          <div className="flex items-center justify-between px-6 py-4
                          border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl
                               bg-accent-primary/10 text-accent-primary">
                <BookOpen size={18} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("about.authorStory", "作者感言")}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t("about.authorStoryDesc", "项目背后的故事")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900
                         dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800
                         transition-colors"
              aria-label={t("common.close", "关闭")}
            >
              <X size={18} />
            </button>
          </div>

          {/* 正文 */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading && (
              <div className="text-center text-sm text-zinc-500 dark:text-zinc-400 py-8">
                {t("common.loading", "加载中...")}
              </div>
            )}

            {!loading && error && (
              <div className="text-center text-sm text-zinc-500 dark:text-zinc-400 py-8 space-y-3">
                <div>{t("about.authorStoryLoadFailed", "作者感言加载失败")}</div>
                <a
                  href="https://github.com/cropflre/nowen-note/blob/main/AUTHOR_STORY.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent-primary hover:underline"
                >
                  <ExternalLink size={11} />
                  {t("about.authorStoryViewOnGithub", "在 GitHub 阅读")}
                </a>
              </div>
            )}

            {!loading && !error && content && (
              <div className="shared-note-content author-story-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* 底栏 */}
          <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800
                          flex items-center justify-between shrink-0
                          bg-zinc-50 dark:bg-zinc-900/60">
            <a
              href="https://github.com/cropflre/nowen-note"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-accent-primary
                         inline-flex items-center gap-1 transition-colors"
            >
              <ExternalLink size={11} />
              {t("about.github", "GitHub")}
            </a>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-accent-primary text-white
                         text-xs font-medium hover:opacity-90 transition-opacity"
            >
              {t("whatsNew.gotIt", "我知道了")}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(node, document.body);
}
