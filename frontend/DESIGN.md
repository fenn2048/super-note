# Super Note UI/UX Design System (v2)

> **单一事实来源**。实现以 `src/index.css`、`tailwind.config.cjs`、`src/lib/navigation.config.ts` 为准。  
> 过时文档：`docs/ui_ux_implementation.md` 中五皮肤 / 旧底栏五项描述已废弃，以本文为准。

---

## 1. Product & Aesthetic

| 项 | 决策 |
|----|------|
| 定位 | 轻量、安静的家庭私有笔记 / 说说 / 任务工作台 |
| **默认皮肤** | **Obsidian**（护眼纸感 + 浓彩点缀） |
| 明暗 | 与皮肤正交：`html.dark`（next-themes） |
| 移动底栏 | **固定 4 Tab**：笔记 · 任务 · 说说 · 我的（无「首页」Tab；首页在桌面 Rail / 我的入口） |
| 设置 | **独立路由** `#/settings`（可带 tab：`#/settings/appearance`） |

---

## 2. Skins（实装）

`useSkin` → `data-skin`（obsidian 不写 attribute，用 `:root` 默认）

| id | 概念 | 备注 |
|----|------|------|
| `obsidian` | 默认 · 暖米纸感 + 紫强调 | 长文/护眼主路径 |
| `eink` | 类墨水屏 · 高对比低阴影 | 去 blur / 弱阴影 |
| `claude` | 暖石色阅读感 | |
| `mono` | 黑白灰极简 | 无品牌色噪声 |

**已废弃 / 勿再文档化**：Notion、Memos、flomo 五皮肤叙事；`data-skin="macos"` 若仍有 CSS 残留视为 legacy，不新增能力。

---

## 3. Design Tokens

### 3.1 Colors（CSS → Tailwind）

| CSS 变量 | Tailwind |
|----------|----------|
| `--color-bg` | `bg-app-bg` |
| `--color-surface` | `bg-app-surface` |
| `--color-sidebar` | `bg-app-sidebar` |
| `--color-elevated` / solid | `bg-app-elevated` / `bg-app-card` |
| `--color-border` | `border-app-border` |
| `--color-hover` / active | `bg-app-hover` / `bg-app-active` |
| `--color-text-primary`… | `text-tx-primary` / `secondary` / `tertiary` / `quaternary` |
| `--color-accent-primary`… | `bg-accent-primary` / `text-accent-primary` / danger / warning |

**规范**：新代码禁止 `bg-zinc-*` / `text-zinc-*` 字面色阶（历史映射见 tailwind `semanticGrays`，仅兼容存量）。优先 `app` / `tx` / `accent`。

### 3.2 Radius

| 变量 | Tailwind 语义 | 用途 |
|------|---------------|------|
| `--radius-button` | `rounded-button` | 按钮、输入、小控件 |
| `--radius-card` | `rounded-card` | 卡片、列表块 |
| `--radius-window` | `rounded-window` | 弹层、抽屉、大面板 |

优先语义圆角，少写死 `rounded-xl`（存量可分期收敛）。

### 3.3 Motion

- `--duration-fast`: 150ms · `--duration-normal`: 220ms  
- `--ease-out-soft`: `cubic-bezier(0.22, 1, 0.36, 1)`  
- 尊重 `prefers-reduced-motion`（`useReducedMotion`）

### 3.4 Spacing（页面约定，非强制 sys-* 类）

| 场景 | 建议 |
|------|------|
| 页面边距 | `p-4 md:p-6` |
| 卡片内边距 | `p-3` / `p-4` |
| 列表行高 | `min-h-11` / `min-h-12`（触控 ≥ 44px） |

---

## 4. Layout

### 4.1 Desktop（`md+`）

```
┌──────────┬────────────┬─────────────┬──────────────────────┐
│ NavRail  │  Sidebar   │  NoteList   │  Main (viewMode)     │
│ 48/64px  │ 可拖宽     │ 可拖宽      │  flex:1              │
└──────────┴────────────┴─────────────┴──────────────────────┘
         + 全局音乐底栏 --global-music-bar-height
```

- Rail 模式：`icon` / `label` / `hidden`；侧栏折叠时强制显示 Rail。  
- Sidebar 仅笔记 / 项目相关视图显示。

### 4.2 Mobile

```
┌─────────────────────────────┐
│ ChromeHeader / 模块顶栏       │  可滚动隐栏
├─────────────────────────────┤
│ 内容（list / editor 栈）      │  mobile-content-pad
├─────────────────────────────┤
│ Tab: 笔记 | 任务 | 说说 | 我的 │  可滚动隐栏
│ FAB 新建                      │
└─────────────────────────────┘
抽屉：侧滑 Sidebar（工作区/笔记本/标签）
```

- 栈页（资料库、编辑器、项目详情等）隐藏底栏：`shouldShowMobileTabBar`。  
- Safe area：`--safe-area-top/bottom`（含 Android/iOS 原生兜底）。

### 4.3 Navigation source

**唯一模块表**：`src/lib/navigation.config.ts`  
消费方：NavRail、MobileTabBar、「我的」、Cmd-K、侧栏次级。  
激活态：`isModuleActive(modId | NavModule, viewMode)`。

---

## 5. Z-Index Scale

使用 CSS 变量（`index.css`）与 Tailwind 任意值，**禁止**新代码 `z-[9999]` / `z-[10000]`。

| Token | 值 | 用途 |
|-------|-----|------|
| `--z-base` | 0 | 内容 |
| `--z-sticky` | 10 | 列表/编辑器粘性顶栏 |
| `--z-rail-fab` | 40 | 底栏、FAB（底栏可用 35） |
| `--z-drawer-backdrop` | 40 | 移动抽屉遮罩 |
| `--z-drawer` | 50 | 移动抽屉面板 |
| `--z-modal-backdrop` | 100 | 模态遮罩 |
| `--z-modal` | 110 | 模态内容 / 重要浮层 |
| `--z-popover` | 120 | 菜单、日期、slash |
| `--z-toast` | 200 | Toaster |
| `--z-lightbox` | 300 | 媒体/Mermaid 全屏 |
| `--z-system` | 1000 | 锁机、屏保、系统级 |

Tailwind 快捷类（见 `index.css` `@layer utilities`）：`z-drawer`、`z-modal`、`z-toast` 等。

---

## 6. Page Contract（一级页面）

每个 `*Center` / 一级视图应：

1. **顶栏**：`MobileChromeHeader` 或 `layout/PageHeader`  
2. **内容**：单一主滚动容器 + 统一底栏避让（`mobile-content-pad` / CSS 变量）  
3. **空 / 载 / 错**：`components/common/FeedbackStates`  
4. **主按钮**：优先 `@/components/ui/button`  

---

## 7. Settings Route

| 行为 | 实现 |
|------|------|
| 打开 | `hash = #/settings` 或 `#/settings/{tabId}`；`viewMode = "settings"` |
| 关闭 | 恢复进入前 viewMode / hash |
| 事件 | `super:open-settings` detail `{ tab?: TabId }` 仍可用 |

---

## 8. Component Primitives

| 组件 | 路径 |
|------|------|
| Button | `components/ui/button` |
| Feedback | `components/common/FeedbackStates` |
| Mobile header | `components/common/MobileChromeHeader` |
| Page header | `components/layout/PageHeader` |
| Shell：底栏 / 抽屉 | `components/shell/*` |

---

## 9. Implementation map (v2.1)

| 能力 | 路径 |
|------|------|
| 主内容表驱动 | `src/components/viewRegistry.tsx` |
| 页面画布 | `src/components/layout/ContentCanvas.tsx` |
| 页头 | `src/components/layout/PageHeader.tsx` |
| 空/载/错 | `src/components/common/FeedbackStates.tsx` |
| 设置（主区内嵌 page / 可选 portal modal） | `SettingsModal` + `viewMode=settings` + `#/settings` |

## 10. Changelog

- **v2**：冻结 Obsidian 默认、4 Tab、z-index、Page Contract、设置路由。  
- **v2.1**：NoteList/Dashboard FeedbackStates；ContentCanvas；VIEW_REGISTRY 瘦 App；Settings 主区非 portal；Settings 去 zinc。  
- **v2.2**：Project / Finance / Diary 顶栏迁入 `MobileChromeHeader` + `PageHeader`；Finance 列表/解锁用 ContentCanvas + FeedbackStates；Project 网格空态/加载统一 FeedbackStates。  
- **v2.3**：Library / AI 顶栏同样迁入；资料库 Hub 用 ContentCanvas；AI 空态/加载用 FeedbackStates；`--library-chrome-height` 仍由顶栏 ref 写入。
