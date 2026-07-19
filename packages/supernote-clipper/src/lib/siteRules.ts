/**
 * 站点净化规则（C3）— 配置化列表，便于扩展
 * 在 content script 的 Document 上执行。
 */

export interface SiteRule {
  /** 主机名包含匹配（小写） */
  hosts: string[];
  /** 正文容器选择器（取第一个命中，替换 body 内容） */
  contentSelector?: string;
  /** 需要移除的选择器 */
  remove: string[];
  /** 懒加载图属性 → src */
  lazyAttrs?: string[];
}

/** 家庭/创作者高频站 */
export const SITE_RULES: SiteRule[] = [
  {
    hosts: ["mp.weixin.qq.com"],
    contentSelector: "#js_content",
    lazyAttrs: ["data-src", "data-original-src"],
    remove: [
      ".reward_area",
      ".js_ad_area",
      ".qr_code_pc_outer",
      ".qr_code_pc",
      "#meta_content",
      "#js_profile_qrcode",
      ".rich_media_area_extra",
      "#js_pc_qr_code",
      ".rich_media_meta_list",
      ".copyright_area",
      "div.rich_media_btn_group",
    ],
  },
  {
    hosts: ["zhihu.com"],
    remove: [
      ".ContentItem-actions",
      ".Reward",
      ".Comments-container",
      ".Question-sideColumn",
      ".QuestionHeader-side",
      ".Question-mainColumnLoginSource",
      ".AuthorInfo-followStatus",
      ".Modal-wrapper",
      ".signFlowModal",
      ".Adouter",
      ".RichContent-actions",
      ".ContentItem-action",
      ".AuthorInfo-badge",
    ],
  },
  {
    hosts: ["csdn.net"],
    remove: [
      "aside",
      ".csdn-side-toolbar",
      ".recommend-box",
      ".template-box",
      ".comment-box",
      "#comment_title",
      "#comment_list",
      ".pulldown-nav",
      ".login-mark",
      ".hide-article-box",
      ".adsbygoogle",
      ".opt-box",
    ],
  },
  {
    hosts: ["juejin.cn"],
    remove: [
      ".sidebar",
      ".article-suspended-panel",
      ".comment-list-box",
      ".recommended-area",
      ".author-block",
      ".tag-list-box",
      ".juejin-active-ad",
      ".banner",
    ],
  },
  // —— C3 扩展 ——
  {
    hosts: ["sspai.com"],
    contentSelector: ".article-body, .article__body, #article-content",
    remove: [
      ".article-side",
      ".comment-box",
      ".related-articles",
      ".ss-app-banner",
      ".series-widget",
      "aside",
    ],
  },
  {
    hosts: ["jianshu.com"],
    contentSelector: "article, ._2rhmJa",
    remove: [
      "aside",
      ".note-bottom",
      ".comment-list",
      ".follow-detail",
      "#note-ad",
      ".support-author",
    ],
  },
  {
    hosts: ["36kr.com"],
    contentSelector: ".articleDetailContent, .common-width.content",
    remove: [
      ".article-footer",
      ".kr-loading-bar",
      ".article-related",
      ".comment-list",
      "aside",
      ".kr-layout-sidebar",
    ],
  },
  {
    hosts: ["toutiao.com", "jinritoutiao.com", "iesdouyin.com"],
    contentSelector: "article, .article-content, .syl-article-base",
    lazyAttrs: ["data-src", "data-original"],
    remove: [
      ".comment-list",
      ".related-video",
      ".article-sidebar",
      ".tt-ad",
      "aside",
      ".feed-card",
    ],
  },
  {
    hosts: ["bilibili.com"],
    contentSelector: "#article-content, .article-content, .opus-module-content",
    lazyAttrs: ["data-src"],
    remove: [
      ".comment",
      ".bb-comment",
      ".recommend-list",
      ".up-info",
      ".right-side-bar",
      ".v-sidebar",
      ".ad-report",
      "aside",
    ],
  },
  {
    hosts: ["xiaohongshu.com", "xhslink.com"],
    contentSelector: "#detail-desc, .note-text, .desc",
    lazyAttrs: ["data-src"],
    remove: [
      ".comment-container",
      ".engage-bar",
      ".author-container",
      ".related-notes",
      "aside",
    ],
  },
  {
    hosts: ["medium.com"],
    contentSelector: "article",
    remove: [
      "aside",
      "[data-test-id='post-sidebar']",
      ".pw-post-responses",
      ".metabar",
      "footer",
    ],
  },
  {
    hosts: ["smzdm.com"],
    contentSelector: ".expand-container, #articleId, .news_content",
    remove: [".commentBox", ".relate_article", "aside", ".feed-ad"],
  },
];

/** 在 doc 上应用匹配规则 */
export function applyConfiguredSiteRules(doc: Document, hostname: string): void {
  const host = (hostname || "").toLowerCase();
  for (const rule of SITE_RULES) {
    if (!rule.hosts.some((h) => host.includes(h))) continue;

    if (rule.contentSelector) {
      const node = doc.querySelector(rule.contentSelector);
      if (node && doc.body) {
        doc.body.innerHTML = "";
        doc.body.appendChild(node.cloneNode(true));
      }
    }

    if (rule.lazyAttrs?.length) {
      for (const img of Array.from(doc.querySelectorAll("img"))) {
        for (const attr of rule.lazyAttrs) {
          const v = img.getAttribute(attr);
          if (v) {
            img.setAttribute("src", v);
            break;
          }
        }
      }
    }

    if (rule.remove.length) {
      const sel = rule.remove.join(",");
      for (const el of Array.from(doc.querySelectorAll(sel))) {
        el.parentNode?.removeChild(el);
      }
    }
    // 只应用第一条命中规则（更具体的站点优先写在前面）
    break;
  }
}
