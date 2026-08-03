# Super Note — Fluid Motion & Interaction Detail

> 配套 **SSOT**：[`../DESIGN.md`](../DESIGN.md) §11–§16  
> 可执行 token：[`../src/lib/motion.ts`](../src/lib/motion.ts)  
> 本页展开公式、配方与现有组件对照。  
> **不规定**主题色与字体栈。

---

## 1. Why this exists

项目内 spring 参数曾散落为 `stiffness 200–500` / `damping 25–30` 与 `bounce+duration` 混用；时长仅有 150/220ms 两档。结果是「每个面板手感都不一样」。本规范把 Apple WWDC *Designing Fluid Interfaces* 与 design-engineering 实践收敛成 Web 规则，让 AI 与人类共用同一套默认。

---

## 2. Animation decision tree

```
交互发生
  │
  ├─ 键盘发起 / 日见 ≥100 次？ ──是──► 无动画（instant）
  │
  ├─ 有明确目的？（反馈/空间/状态/防突兀）──否──► 无动画
  │
  ├─ 用户可拖拽 / 需打断？ ──是──► Spring（§3）+ 手势（§4）
  │
  └─ 预定路径（modal 开合、颜色）──► CSS transition：transform/opacity + ease-out
```

---

## 3. Springs（Apple → Framer Motion）

Apple 用 **response（秒）** + **damping ratio**；FM 的 `duration` + `bounce` 是对应心智模型：

| 意图 | Apple 近似 | `springs.*` | 备注 |
|------|------------|-------------|------|
| 默认位移 | damping 1.0, response 0.35 | `ui` | 无 overshoot |
| Sheet | damping 1.0, response 0.3 | `sheet` | 抽屉开合 |
| Modal | damping 1.0, response 0.28 | `modal` | 居中缩放 |
| Flick 后 | damping ~0.8 | `momentum` | **仅**有动量时 |
| 小控件 | response ~0.22 | `snappy` | chip / popover |

```ts
import { springs, springWithVelocity } from "@/lib/motion";

// 松手：把手指速度交给弹簧，消除「拖→动画」接缝
transition={springWithVelocity(springs.momentum, releaseVelocityPxPerS)}
```

**不要**在新代码写：

```ts
// ❌ 散落物理三元组，全库无法统一手感
{ type: "spring", stiffness: 350, damping: 30 }
```

若必须调参：先改 `motion.ts` 预设，再让全库受益。

---

## 4. Gesture math

### 4.1 Rubber-band

硬停读作「卡住」；渐进阻力读作「到头了但仍跟手」。

```ts
import { rubberband } from "@/lib/motion";

// overshoot: 越过边界的有符号距离
// dimension: 该轴参考尺寸（如 sheet 高度）
const y = edge + rubberband(overshoot, sheetHeight, 0.55);
```

公式（与 Apple sample 一致）：

\[
\text{rubberband}(o, d, c) = \frac{o \cdot d \cdot c}{d + c \cdot |o|}
\]

### 4.2 Momentum projection

松手后不要「最近静止点吸附」，而要先预测惯性终点：

```ts
import { project, nearestSnap } from "@/lib/motion";

const projected = currentY + project(velocityY, 0.998);
const target = nearestSnap(projected, [0, mid, full]);
// animate spring to target with velocity: velocityY
```

\[
\text{project}(v, d) = \frac{v}{1000} \cdot \frac{d}{1 - d},\quad d \approx 0.998
\]

### 4.3 Velocity from pointer history

```ts
import { velocityFromHistory, type VelocitySample } from "@/lib/motion";

const samples: VelocitySample[] = [];
// on pointermove: samples.push({ position: e.clientY, time: performance.now() })
const v = velocityFromHistory(samples, 100); // px/s
```

### 4.4 Interruptibility

| 错误 | 正确 |
|------|------|
| 动画播放完才能再点 | 随时可抓、可反向 |
| 打断后从 `animate` 目标值重启 | 从当前 transform 呈现值 re-target |
| 手势用 `@keyframes` | 用 spring（FM）或每帧写 transform |
| 反向时速度归零 | 保留/混合 velocity（spring re-target） |

### 4.5 Dismiss heuristics

```ts
import { shouldDismissFromGesture } from "@/lib/motion";

if (shouldDismissFromGesture({
  distance: deltaY,
  velocity: v,
  distanceThreshold: 120,
  velocityThreshold: 110, // px/s
})) dismiss();
```

---

## 5. Component recipes

### 5.1 Button / pressable row

```tsx
// Tailwind
className="transition-transform duration-press ease-out active:scale-[0.97]"

// 仅精细指针 hover
className="[@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover"
```

现有 `Button` 使用 `0.98`（更克制）可保留；新建 pressable 推荐 `0.97`。

### 5.2 Centered modal

```tsx
import { AnimatePresence } from "framer-motion";
import { Motion } from "@/components/common/Motion";
import { springs, variants } from "@/lib/motion";

<AnimatePresence>
  {open && (
    <>
      <Motion.div
        className="fixed inset-0 z-modal-backdrop bg-black/45"
        variants={variants.scrimFade}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <Motion.div
        role="dialog"
        aria-modal
        className="fixed inset-0 z-modal m-auto h-fit w-full max-w-md rounded-window border border-app-border bg-app-card shadow-xl"
        variants={variants.fadeScaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={springs.modal}
      />
    </>
  )}
</AnimatePresence>
```

要点：`scale` 从 **0.96** 起，不是 0；modal origin 居中。

### 5.3 Side drawer

```tsx
<Motion.div
  variants={variants.sheetFromLeft}
  initial="initial"
  animate="animate"
  exit="exit"
  transition={springs.sheet}
  className="fixed inset-y-0 left-0 z-drawer w-[86%] max-w-[340px] bg-app-sidebar shadow-xl"
/>
```

进出都是 `-100% ↔ 0`（空间一致）。拖拽关闭时应 1:1 跟手，越界 `rubberband`，松手 `project` + `springs.momentum`。

### 5.4 Bottom sheet

同 `variants.sheetFromBottom` + `springs.sheet`。堆叠 sheet：下层 dim + 轻微 scale-down。

### 5.5 Popover / menu

```tsx
// transform-origin 指向触发器（非 center）
style={{ transformOrigin: origin }}
variants={variants.popoverIn}
transition={springs.snappy}
```

### 5.6 Toast

- 从底（或顶）滑入，**退出同向**  
- 用 CSS transition / FM 可打断；快速连弹时 transition 会 re-target  
- 勿用一次性 keyframes slideIn  

### 5.7 List stagger

```tsx
<Motion.ul variants={variants.listStagger} initial="initial" animate="animate">
  {items.map((id) => (
    <Motion.li key={id} variants={variants.listItemIn} transition={springs.snappy} />
  ))}
</Motion.ul>
```

stagger **不得** `pointer-events: none`。间隔 30–50ms。

### 5.8 Command palette / shortcuts

**零动画**（或仅 opacity 0→1 且 duration 0）。高频键盘路径上的 spring 会让产品感觉迟钝。

---

## 6. Materials & depth

| 表面 | 建议 |
|------|------|
| 粘性顶栏 | `bg-app-bg/95 backdrop-blur-sm`（现有 PageHeader 方向） |
| 移动底栏 / FAB 区 | 半透明 + blur；内容滚动在下层 |
| Modal scrim | `bg-black/40–50`；任务型打断用 scrim |
| 非模态侧栏 | 可不遮全屏，避免误以为阻断 |
| 大面板阴影 | `shadow-lg` / `shadow-xl` |
| 小芯片 | `shadow-xs` / `shadow-sm` |

禁止 light glass 叠 light glass。  
`prefers-reduced-transparency`：改为实底、去掉 blur。

---

## 7. Spacing & hierarchy (structure only)

| 模式 | 值 |
|------|-----|
| 触控最小 | 44×44 |
| 页边 | `p-4 md:p-6` |
| 卡片内 | `p-3` / `p-4` |
| 行高 | `min-h-11`–`12` |
| 分组间距 | `sys-xl` / `gap-6` |
| 字色层级 | primary → secondary → tertiary → quaternary |
| 圆角 | button / card / window 语义 token |
| z | DESIGN.md §5 变量，禁魔法数字 |

---

## 8. Before / After（对照存量）

| 位置 | Before | After |
| --- | --- | --- |
| `MobileDrawer` | `transition={{ type:"spring", bounce:0, duration:0.35 }}` | `transition={springs.sheet}` + `variants.sheetFromLeft` |
| `AppModal` | `duration: 0.15` + scale 0.96 | `springs.modal` + `variants.fadeScaleIn`；遮罩用 `scrimFade` |
| `button.tsx` | `transition-all` + `active:scale-[0.98]` | 新代码：`transition-transform duration-press ease-out`；scale 0.97–0.98 |
| `PullToRefresh` | `deltaY * 0.45` 线性阻尼 | 新下拉：`rubberband(overshoot, viewportH)` |
| `ProjectCenter` 等 | `stiffness: 350, damping: 30` 等 | 映射到最近 `springs.*` |
| `CommandPalette` | 若加 spring 开合 | **删除动画**或 instant |
| 任意 hover scale | 无 media query | `@media (hover: hover) and (pointer: fine)` |

> **v2.5**：存量 spring / 过小 scale / 多数 `transition-all` 与固定 duration 已批量对齐 After 列；新增代码仍须直接使用 `@/lib/motion`。

---

## 9. Reduced motion

1. CSS：`index.css` 已把 animation/transition 压到近 0。  
2. JS：用 `<Motion.div>`（内部 `useReducedMotion` 清空 initial/animate/exit/while*）。  
3. 手写 `motion.*` 时：

```ts
const reduce = useReducedMotion();
transition={reduce ? { duration: 0 } : springs.sheet}
animate={reduce ? { opacity: 1 } : { x: 0 }}
```

Reduced ≠ 无反馈：可保留短 fade，去掉位移与弹性。

---

## 10. Performance

- 只改 `transform` / `opacity`（及可选轻 blur）。  
- 避免在父级改 CSS 变量驱动大量子树动画；直接写元素 `transform`。  
- 主线程繁忙时，预定动画优先纯 CSS；动态手势用 FM spring。  
- FM 的 `x`/`y` 简写在重载下可能掉帧；关键路径可改 `transform: "translateX(...)"`。

---

## 11. AI quick copy-paste

```ts
import { Motion } from "@/components/common/Motion";
import {
  springs,
  variants,
  rubberband,
  project,
  nearestSnap,
  velocityFromHistory,
  springWithVelocity,
  shouldAnimate,
} from "@/lib/motion";

// 键盘？算了
if (!shouldAnimate({ keyboardInitiated: isKey })) { /* 瞬切 */ }

// 默认面板
transition={springs.sheet}
variants={variants.sheetFromBottom}
```

清单见 DESIGN.md §16.2。
