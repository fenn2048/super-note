# Super Note UI/UX Design System (v2)

> **单一事实来源**。实现以 `src/index.css`、`tailwind.config.cjs`、`src/lib/navigation.config.ts`、`src/lib/motion.ts` 为准。  
> 过时文档：`docs/ui_ux_implementation.md` 中五皮肤 / 旧底栏五项描述已废弃，以本文为准。  
> 动效细则：[`docs/MOTION.md`](./docs/MOTION.md) · AI 入口：仓库根 [`AGENTS.md`](../AGENTS.md)

### For AI agents

生成或修改 UI / 动效时：

1. 读完 **§11–§16**（本文）与必要时 `docs/MOTION.md`。
2. 弹簧、rubberband、投影、velocity 一律从 `@/lib/motion` 引用，禁止手写散落 spring 参数。
3. 新动效组件优先 `@/components/common/Motion`，不要裸用 `motion.*`。
4. **不要改** 皮肤色板、`data-skin` 配色、字体栈 / 编辑器字体族（除非用户明确要求）。
5. 颜色只用语义 token：`app` / `tx` / `accent`；圆角 `rounded-button|card|window`；阴影 `shadow-xs`…`xl`。

---

## 1. Product & Aesthetic

| 项 | 决策 |
|----|------|
| 定位 | 轻量、安静的家庭私有笔记 / 说说 / 任务工作台 |
| **主题** | **仅 light / dark**（`next-themes`，`html.dark`）。**已移除**多皮肤（obsidian/eink/claude/mono）与站点级字体设置 |
| 字体 | 系统 UI 栈（`--editor-font-family` 固定）；不提供编辑器字体 / 霞鹜文楷开关 |
| 移动底栏 | **固定 4 Tab**：笔记 · 任务 · 说说 · 我的（无「首页」Tab；首页在桌面 Rail / 我的入口） |
| 设置 | **独立路由** `#/settings`（可带 tab：`#/settings/appearance`） |
| Bottom sheets | 统一 **`@/components/common/BottomSheet`**（拖拽 + rubberband + project + velocity handoff） |

---

## 2. Theme（light / dark only）

- 切换：`ThemeToggle` / `useTheme()` from `next-themes`
- **禁止** 再写 `data-skin` 或引入新皮肤变量
- `useSkin` / `SkinSwitcher` 为兼容空壳，勿在新代码使用

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

完整规范见 **§11–§12**。摘要：

| Token | 值 | Tailwind / JS |
|-------|-----|---------------|
| `--duration-instant` | 0ms | `duration-instant` |
| `--duration-press` | 120ms | `duration-press` |
| `--duration-micro` | 160ms | `duration-micro` |
| `--duration-fast` | 150ms | `duration-fast` |
| `--duration-normal` | 220ms | `duration-normal` |
| `--duration-panel` | 280ms | `duration-panel` |
| `--duration-sheet` | 360ms | `duration-sheet` |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | `ease-out` |
| `--ease-out-soft` | `cubic-bezier(0.22, 1, 0.36, 1)` | `ease-soft` |
| `--ease-in-out-strong` | `cubic-bezier(0.77, 0, 0.175, 1)` | `ease-inout` |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | `ease-drawer` |

弹簧与手势：`import { springs, rubberband, project } from "@/lib/motion"`。  
无障碍：`useReducedMotion` + `<Motion.*>`（`components/common/Motion.tsx`）。

### 3.4 Spacing（页面约定，非强制 sys-* 类）

| 场景 | 建议 |
|------|------|
| 页面边距 | `p-4 md:p-6` |
| 卡片内边距 | `p-3` / `p-4`（`sys-md` / `sys-lg`） |
| 列表行高 | `min-h-11` / `min-h-12`（触控 ≥ 44px） |
| 相关控件间距 | `gap-2`–`gap-3`（`sys-sm`–`sys-md`） |
| 区块分隔 | `gap-6` / `space-y-6`（`sys-xl`–`sys-xxl`） |
| 图标按钮命中 | `size-icon-lg` / `min-h-[44px] min-w-[44px]` |

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
- **v2.4 Motion Craft**：§11–§16 界面与流体动效规范；`src/lib/motion.ts`；CSS/Tailwind ease·duration 阶梯；`docs/MOTION.md`；根 `AGENTS.md`。**不改变**皮肤色与字体栈。  
- **v2.5 Motion Align**：存量组件 spring/时长/`transition-all`/过小 scale 对齐 `@/lib/motion` 与 §11–§16；原语 `Button`/`AppModal`/`MobileDrawer`/`PullToRefresh`/`confirm` 采用预设；Cmd-K 保持零开合动画。  
- **v2.6 Theme + BottomSheet**：去掉多皮肤与站点字体设置，仅 light/dark；新增可拖拽 `BottomSheet` 原语并迁移主要 sheet；装饰性 infinite 动画保留。  
- **v2.6.1 Sheet 批量迁移**：ProjectCenter（任务操作/角色/项目筛选/新建任务）、DiaryCompose 媒体菜单、TaskDetailModal（移动）、NoteList、AccountPicker、FinanceCenter Modal、RulesPanel、ReadingDashboard、MediaCenter 影评、GlobalMusicPlayer 全屏播放器、MobileTaskCreate 子抽屉等统一 `BottomSheet`。新建任务主面板仍为 `springs.sheet` 入场（键盘避让布局，子选择器用 BottomSheet）。

---

## 11. Motion & Craft Principles

> 目标：原生 iOS 质感 + 物理真实感。灵感来自 Apple WWDC *Designing Fluid Interfaces* 与 design-engineering 实践。  
> **范围**：动效、间距层级、材质、交互反馈。**不包含**：主题色板、字体族（沿用现有 skin / 用户设置）。

### 11.1 决策框架（写动画前必答）

#### 1) 应不应该动画？

| 日见频次 | 决策 |
|----------|------|
| 100+ 次/天（快捷键、Cmd-K、列表方向键） | **禁止动画** |
| 数十次/天（hover、密集列表滑过） | 去掉或极短（≤120ms） |
| 偶尔（Modal、Drawer、Toast） | 标准动效 |
| 罕见（引导、首次成功） | 可略加 delight |

**键盘触发的操作永远不要动画。** 动画会让高频操作感觉延迟。

#### 2) 目的是什么？

合法目的：空间一致 · 状态表达 · 解释 · 按压反馈 · 避免元素凭空出现/消失。  
若只有「好看」且会高频出现 → 不做。

#### 3) 缓动怎么选？

| 场景 | 缓动 |
|------|------|
| 进入 / 退出 | `ease-out` / `--ease-out`（**禁止 ease-in**） |
| 屏上移动 / morph | `--ease-in-out-strong` |
| Sheet 非手势 CSS 路径 | `--ease-drawer` |
| 颜色 / 边框 | `--ease-out-soft` 或 `ease` |
| 进度 / hold-to-confirm | `linear` |

#### 4) 时长？

UI 动效以 **≤300ms** 为主（sheet 可到 ~360ms）。详见 §12。  
退出可略快于进入；hold 类交互：按下慢、释放快。

#### 5) 只动画合成属性

优先 **`transform` + `opacity`**。必要时过渡中短暂 `filter: blur(≤2px)` 遮瑕。  
禁止动画 `width` / `height` / `margin` / `padding`（layout 动画须显式注释例外）。  
禁止 `transition: all` / `transition-all`——只声明具体属性。

### 11.2 硬性禁止

| 禁止 | 改为 |
|------|------|
| `scale(0)` 入场 | `scale(0.95–0.97)` + `opacity: 0` |
| `ease-in` UI | `ease-out` / 自定义 out 曲线 |
| 键盘动作带动画 | 无动画（`duration-instant`） |
| 手势中途用 CSS keyframes | spring，且可从当前值 re-target |
| 过渡期间锁死输入 | 始终可打断 |
| 触控上的 hover 缩放 | `@media (hover: hover) and (pointer: fine)` |
| 裸 `z-[9999]` | §5 z-index token |
| 散落 `stiffness/damping` | `@/lib/motion` 的 `springs.*` |

### 11.3 组件级 craft

| 模式 | 规则 |
|------|------|
| 按钮 / 可点行 | `:active` → `scale(0.97–0.98)`，120ms ease-out；pointer-**down** 即反馈 |
| Popover | `transform-origin` 锚向触发器；modal **例外**保持中心 |
| **Bottom sheet** | 一律 `@/components/common/BottomSheet`：手柄拖拽、越界 rubberband、松手 `project`+`velocity` 吸附/关闭 |
| Tooltip | 首次可 delay；同组后续 **instant**（无 delay、无动画） |
| 列表入场 | stagger 30–50ms；**不** `pointer-events: none` 阻塞交互 |
| Toast | 进出同向；用 transition 勿用不可打断 keyframes |
| 可打断 UI | CSS transition 或 spring；避免一次性 keyframes |

---

## 12. Motion Tokens

### 12.1 时长与缓动（CSS ↔ Tailwind）

见 §3.3 表。示例：

```html
class="transition-transform duration-press ease-out active:scale-[0.97]"
class="transition-opacity duration-panel ease-out"
```

### 12.2 弹簧预设（framer-motion）

```ts
import { springs } from "@/lib/motion";

// 默认 UI / 抽屉 / 模态：critically damped（bounce: 0）
transition={springs.ui}      // duration 0.35
transition={springs.sheet}   // 0.32
transition={springs.modal}   // 0.28
transition={springs.snappy}  // 0.22

// 仅在用户 flick / 拖拽松手后使用微弹
transition={springs.momentum} // bounce 0.18, duration 0.4
```

对齐 Apple 的 **damping ratio + response** 心智：默认 damping≈1.0（无 overshoot）；有动量时 damping≈0.8。

### 12.3 配方 variants

```ts
import { variants, springs } from "@/lib/motion";
import { Motion } from "@/components/common/Motion";

<Motion.div
  variants={variants.fadeScaleIn}
  initial="initial"
  animate="animate"
  exit="exit"
  transition={springs.modal}
/>
```

| Export | 用途 |
|--------|------|
| `variants.fadeScaleIn` | 居中 Modal |
| `variants.scrimFade` | 遮罩 |
| `variants.sheetFromLeft/Right/Bottom` | 抽屉；进出同路径 |
| `variants.popoverIn` | 小浮层 scale 0.97 |
| `variants.listItemIn` + `listStagger` | 列表错落入场 |

### 12.4 工具函数

| 函数 | 作用 |
|------|------|
| `rubberband(overshoot, dimension, 0.55)` | 边界阻尼（非硬停） |
| `project(velocityPxPerS, 0.998)` | 动量投影落点 |
| `nearestSnap(value, points)` | 投影后吸附 |
| `velocityFromHistory(samples)` | 指针历史估速 px/s |
| `springWithVelocity(base, v)` | 松手速度交接 |
| `shouldDismissFromGesture(...)` | 距离或 flick 解雇 |
| `shouldAnimate({ keyboardInitiated })` | 是否允许动画 |

---

## 13. Fluid Gestures（Apple → Web）

### 13.1 七条铁律

1. **Response**：pointer-down 立刻反馈；警惕 debounce / 300ms 点击延迟。  
2. **1:1 直接操作**：拖拽时内容贴手指；`setPointerCapture`；保留 grab offset（勿吸到中心）。  
3. **可中断**：动画中可再抓；始终从**当前呈现值**开启动画，勿从逻辑目标值跳变。  
4. **行为优于脚本**：手势用 spring，不用固定时长 timeline。  
5. **Velocity handoff**：松手弹簧 `velocity` = 手指 px/s，接缝不可见。  
6. **Momentum projection**：用 `project(v)` 预测落点再 `nearestSnap`，不要只在松手位置吸附。  
7. **Rubber-band**：越界用 `rubberband`，硬夹 `Math.min/max` 仅作最后安全网。

### 13.2 手势细节

| 项 | 值 / 行为 |
|----|-----------|
| 轴锁定迟滞 | ~10px（`GESTURE_AXIS_LOCK_PX`）后锁定方向 |
| 命中膨胀 | 可点区域外扩约 10px 更易点 |
| 多点触控 | 拖拽开始后忽略额外手指 |
| Flick 解雇 | `|v| ≥ ~110 px/s` 或过距离阈值 |
| 并行识别 | 先并行侦测，意图明确后再取消失败者 |
| 手势锁 | 子树 `[data-swipe-blocker]` 阻断全局侧滑（见 `App.tsx`） |

### 13.3 空间一致

- **进出同路径**：左进必须左出；底进必须底出。  
- **源锚定**：菜单/popover 从触发器展开（`transform-origin`）。  
- **Modal** 保持视口中心 origin。  
- 可逆过渡镜像缓动（出/回对称）。

### 13.4 现有实现对齐参考

| 组件 | 现状 | 规范方向 |
|------|------|----------|
| `MobileDrawer` | `springs` 风格 bounce:0 duration 0.35 | 对齐 `springs.sheet` + `variants.sheetFromLeft` |
| `AppModal` | duration 0.15 scale 0.96 | `springs.modal` + `variants.fadeScaleIn` |
| `button` | `active:scale-[0.98]` | 可保留 subtle；新 pressable 用 0.97 |
| `PullToRefresh` | 线性 `* 0.45` 阻尼 | 新代码优先 `rubberband` |
| `CommandPalette` | 键盘高频 | **开合无动画**或极短 opacity |
| `Motion.tsx` | reduced-motion 降级 | 新代码默认入口 |

---

## 14. Materials, Elevation & Feedback

### 14.1 材质层级

| 层 | 用法 |
|----|------|
| Chrome（顶/底栏） | 半透明 + `backdrop-filter: blur(12–20px) saturate(180%)`；内容可从下穿过 |
| Sheet / Drawer | 更重材质 + `shadow-lg`/`xl`；堆叠时下层 dim + 可略 scale |
| Modal scrim | `bg-black/40–50` + 可选轻 blur；**打断任务流**用 scrim |
| 并行面板 | 半透明偏移即可，**不要**强 scrim |
| 禁止 | 浅色半透明叠浅色半透明（可读性崩坏） |

材质入场应「物化」：blur + scale + opacity 同步，不要只有 fade。

### 14.2 阴影与层次

- 使用 `shadow-xs` → `xl` / `shadow-accent` / `shadow-fab`。  
- 表面越大、浮得越高 → 阴影越深。  
- 层次：`bg` → `surface` → `elevated`/`card` → modal；靠阴影与材质，不靠随机 z。  
- z-index 只用 §5 token。

### 14.3 交互反馈矩阵

| 类型 | 表现 |
|------|------|
| 状态 | 选中/激活用 `bg-app-active` / accent 色，非仅靠字重 |
| 完成 | 短反馈；移动端可 `haptic.success` |
| 警告 | 不可逆前确认；少用阻断式 dialog |
| 错误 | 就地校验，勿只在 submit 弹一次 |
| Press | scale 0.97–0.98 @ press duration |
| Hover | 仅精细指针；`bg-app-hover` |

### 14.4 视觉层次（与主题色无关）

| 层级 | Token |
|------|-------|
| 主文 | `text-tx-primary` |
| 次文 | `text-tx-secondary` |
| 说明 | `text-tx-tertiary` |
| 禁用/极弱 | `text-tx-quaternary` |
| 强调操作 | `text-accent-primary` / `bg-accent-primary` |

圆角只用语义：`rounded-button` · `rounded-card` · `rounded-window` · `rounded-full`（pill）。

---

## 15. Accessibility（Motion & Transparency）

| 信号 | 行为 |
|------|------|
| `prefers-reduced-motion: reduce` | 去掉位移/弹簧/overshoot；保留短 opacity 交叉淡入；使用 `<Motion.*>` 或 `useReducedMotion` |
| `prefers-reduced-transparency`（若实现） | 提高背景不透明度；去掉 `backdrop-filter` |
| `prefers-contrast: more` | 更实底 + 清晰边框 |
| 大位移元素 | 移动中可半透明，落稳后恢复 |

全局 CSS 已在 `index.css` 将 transition/animation 压到近 0；**framer-motion 必须**走 `Motion` 或手写 reduce 分支。

---

## 16. AI Authoring Rules & Checklist

### 16.1 生成 UI 时强制

1. 遵循本文 §3–§9 布局 / token / Page Contract / z-index。  
2. 动效遵循 §11–§15；细节查 `docs/MOTION.md`。  
3. `import { springs, variants, rubberband, project, ... } from "@/lib/motion"`。  
4. 动效 DOM 用 `import { Motion } from "@/components/common/Motion"`。  
5. 不修改皮肤色变量与字体族配置（除非用户点名）。  
6. 原语优先：`@/components/ui/button`、`FeedbackStates`、`PageHeader`、`ContentCanvas`、`AppModal`。

### 16.2 自检清单

- [ ] 此交互是否高频/键盘触发 → 应零动画？  
- [ ] 是否只用语义色/圆角/阴影/z-index token？  
- [ ] 是否避免 `transition-all`、`scale(0)`、`ease-in`？  
- [ ] 弹簧是否来自 `springs.*`？  
- [ ] 手势是否 1:1、可中断、越界 rubberband、松手带 velocity？  
- [ ] 进出是否同路径？popover origin？modal 居中？  
- [ ] 是否用 `<Motion.*>` / reduced-motion？  
- [ ] 触控目标 ≥44px？  
- [ ] hover 是否包在 `(hover: hover) and (pointer: fine)`？  
- [ ] stagger 是否不阻塞点击？

### 16.3 代码片段（推荐默认）

**Pressable：**

```tsx
className="transition-transform duration-press ease-out active:scale-[0.97]"
```

**Modal：**

```tsx
import { Motion } from "@/components/common/Motion";
import { springs, variants } from "@/lib/motion";

<Motion.div
  variants={variants.fadeScaleIn}
  initial="initial"
  animate="animate"
  exit="exit"
  transition={springs.modal}
  className="rounded-window bg-app-card shadow-xl border border-app-border"
/>
```

**Drawer：**

```tsx
<Motion.div
  variants={variants.sheetFromLeft}
  initial="initial"
  animate="animate"
  exit="exit"
  transition={springs.sheet}
/>
```

更多公式与 Before/After 见 [`docs/MOTION.md`](./docs/MOTION.md)。
