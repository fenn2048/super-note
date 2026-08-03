import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import i18n from "i18next";
import { api } from "@/lib/api";

export interface SiteConfig {
  title: string;
  favicon: string;
  editorFontFamily: string; // 空串=默认(Inter), 自定义字体 id, 或内置字体名
  lxgwWenkaiEnabled: boolean;
  // 注：v6 起，"个人空间导出/导入"不再是站点级全站开关；它已下沉为 users 表
  // 的 personalExportEnabled / personalImportEnabled 两列，由管理员在
  // 「用户管理 → 编辑用户」里为每个用户独立控制。消费方（Sidebar、DataManager）
  // 请读当前登录用户自己（api.getMe() 的返回）上的这两字段，不要再从这里读。
}

const DEFAULT_CONFIG: SiteConfig = {
  title: "蜉蝣",
  favicon: "",
  editorFontFamily: "",
  lxgwWenkaiEnabled: false,
};

// 内置字体选项（不需要上传）
export const BUILTIN_FONTS = [
  { id: "", nameKey: "fonts.interDefault", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "__system", nameKey: "fonts.systemDefault", family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: "__serif", nameKey: "fonts.serif", family: "Georgia, 'Noto Serif SC', 'Source Han Serif SC', serif" },
  { id: "__mono", nameKey: "fonts.monospace", family: "'Cascadia Code', 'Fira Code', 'Source Code Pro', 'Menlo', 'Consolas', monospace" },
];

// Helper to get translated font name
export function getBuiltinFontName(font: typeof BUILTIN_FONTS[number]): string {
  return i18n.t(font.nameKey);
}

interface SiteSettingsContextValue {
  siteConfig: SiteConfig;
  updateSiteConfig: (title: string, favicon: string) => Promise<void>;
  updateEditorFont: (fontId: string) => Promise<void>;
  updateLxgwWenkaiEnabled: (enabled: boolean) => Promise<void>;
  isLoaded: boolean;
}

const SiteSettingsContext = createContext<SiteSettingsContextValue>({
  siteConfig: DEFAULT_CONFIG,
  updateSiteConfig: async () => {},
  updateEditorFont: async () => {},
  updateLxgwWenkaiEnabled: async () => {},
  isLoaded: false,
});

/**
 * 应用站点标题与 favicon 到 DOM。
 *
 * 历史坑点（2026-04 修复）：
 *  1. index.html 里同时存在 `<link rel="icon">`、`<link rel="alternate icon">`、
 *     `<link rel="apple-touch-icon">`。以前只更新第一个，其他继续指向旧 URL,
 *     浏览器可能回退到 `alternate icon` → 看起来"换了没生效"。
 *  2. 直接改 `link.href` 时，浏览器常常复用已缓存的 favicon 不刷新。稳妥做法
 *     是 **移除旧节点、新建节点**，这样浏览器必须重新发起解析。
 *  3. 之前 `link.type` 只识别 svg / png / x-icon，上传 jpg/webp/ico 时一律被
 *     写成 image/png → 某些浏览器直接拒渲。改为从 data URL 真实 MIME 读取。
 */
function parseDataUrlMime(url: string): string {
  // data:image/png;base64,... → image/png
  const m = /^data:([^;,]+)[;,]/i.exec(url);
  return m ? m[1].toLowerCase() : "image/png";
}

function applyToDOM(title: string, faviconUrl: string) {
  document.title = title || "蜉蝣";

  // 清理页面上所有"图标类"link（含 alternate/apple-touch/shortcut），避免旧节点覆盖新节点
  const oldLinks = document.head.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="alternate icon"], link[rel="apple-touch-icon"]'
  );
  oldLinks.forEach((n) => n.parentNode?.removeChild(n));

  // 新建主 icon 节点
  const link = document.createElement("link");
  link.rel = "icon";
  if (faviconUrl) {
    link.type = parseDataUrlMime(faviconUrl) || "image/png";
    link.href = faviconUrl;
  } else {
    // 恢复内置品牌 favicon（与 index.html 保持一致）
    link.type = "image/svg+xml";
    link.href = "/favicon.svg";
  }
  document.head.appendChild(link);

  // apple-touch-icon 同步更新；自定义图标时复用相同 href（PWA/添加到主屏幕体验一致）
  const apple = document.createElement("link");
  apple.rel = "apple-touch-icon";
  apple.href = faviconUrl || "/apple-touch-icon.svg";
  document.head.appendChild(apple);
}

/** System UI stack only — product no longer exposes custom editor fonts / 霞鹜文楷. */
const SYSTEM_EDITOR_FONT =
  'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

function applyEditorFont(_fontId?: string, _customFontName?: string) {
  document.documentElement.style.setProperty("--editor-font-family", SYSTEM_EDITOR_FONT);
}

/** Always off — removes legacy class/link if present. */
function applyWenkaiFont(_enabled?: boolean) {
  const linkId = "lxgw-wenkai-font-style";
  const link = document.getElementById(linkId);
  if (link) link.parentNode?.removeChild(link);
  document.documentElement.classList.remove("font-lxgw");
}

export function SiteSettingsProvider({ children }: { children: React.ReactNode }) {
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    api.getSiteSettingsPublic().then(async (data) => {
      const config: SiteConfig = {
        title: data.site_title || "蜉蝣",
        favicon: data.site_favicon || "",
        editorFontFamily: data.editor_font_family || "",
        lxgwWenkaiEnabled: data.editor_lxgw_wenkai_enabled === "true",
      };
      setSiteConfig({ ...config, editorFontFamily: "", lxgwWenkaiEnabled: false });
      applyToDOM(config.title, config.favicon);
      applyWenkaiFont(false);
      applyEditorFont();
      setIsLoaded(true);
    }).catch(() => {
      applyToDOM(DEFAULT_CONFIG.title, DEFAULT_CONFIG.favicon);
      applyEditorFont("");
      applyWenkaiFont(false);
      setIsLoaded(true);
    });
  }, []);

  const updateSiteConfig = useCallback(async (title: string, favicon: string) => {
    const data = await api.updateSiteSettings({
      site_title: title,
      site_favicon: favicon,
    });
    const config: SiteConfig = {
      title: data.site_title || "蜉蝣",
      favicon: data.site_favicon || "",
      editorFontFamily: data.editor_font_family || siteConfig.editorFontFamily,
      lxgwWenkaiEnabled: data.editor_lxgw_wenkai_enabled === "true" || siteConfig.lxgwWenkaiEnabled,
    };
    setSiteConfig(config);
    applyToDOM(config.title, config.favicon);
  }, [siteConfig.editorFontFamily, siteConfig.lxgwWenkaiEnabled]);

  /** @deprecated Font settings removed — always system stack. */
  const updateEditorFont = useCallback(async (_fontId: string) => {
    applyEditorFont();
    setSiteConfig((prev) => ({ ...prev, editorFontFamily: "" }));
  }, []);

  /** @deprecated 霞鹜文楷 toggle removed. */
  const updateLxgwWenkaiEnabled = useCallback(async (_enabled: boolean) => {
    applyWenkaiFont(false);
    setSiteConfig((prev) => ({ ...prev, lxgwWenkaiEnabled: false }));
  }, []);

  return (
    <SiteSettingsContext.Provider value={{ siteConfig, updateSiteConfig, updateEditorFont, updateLxgwWenkaiEnabled, isLoaded }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}
