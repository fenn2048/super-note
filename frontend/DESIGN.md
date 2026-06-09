# Super-Note UI/UX Design System Reference

## 1. Overview & Positioning
- **Product Positioning**: A lightweight, quiet, family private note-taking, status sharing (Says), and AI knowledge base tool.
- **Design Aesthetic**: Support multiple highly tailored visual languages (skins) allowing users to align the app with their personal workspace vibe.

---

## 2. Roundness & Corner Radii
The global border-radius maps dynamically in `tailwind.config.cjs` using CSS variables (`--radius-button`, `--radius-card`, and `--radius-window` for `md`, `lg`, and `xl`/`2xl` respectively) so that elements adapt instantly when a new skin is selected.

---

## 3. Core Visual Skins

### 1. Obsidian (Default base)
- **Concept**: Quiet dark theme, high contrast but low visual fatigue, pure flat layout, distraction-free editing.
- **Corner Radius**: Sharp geometric `4px` across all controls, buttons, cards, and windows.
- **Accent Primary**: Quiet active purple (`#7a52f4` in dark mode, `#483699` in light mode).
- **Background**: Dark charcoal `#1e1e1e` (main editor/canvas) and sidebar `#161616`.

### 2. macOS (Redesigned Apple HIG)
- **Concept**: Elegant Apple Human Interface Guidelines, translucency, glassmorphism overlays, soft native shadow levels, and organic shapes.
- **Corner Radius**: Soft rounded shapes: `8px` buttons, `10px` cards, and `12px` window containers.
- **Accent Primary**: System Blue (`#007aff` light, `#0a84ff` dark).
- **Background**: Cool window background `#ececec` (light) or Charcoal `#1e1e1e` (dark) with semi-transparent sidebar.

### 3. Notion (Notion-style Minimalist)
- **Concept**: Signature Notion aesthetic with a warm creamy-grey sidebar, fine borders, and intellectual blue highlights.
- **Corner Radius**: Tiny compact `4px` radius.
- **Accent Primary**: Notion Blue (`#2383e2`).
- **Background**: Main canvas `#ffffff` (light) / `#191919` (dark) with sidebar `#f1f1ef` (light) / `#202020` (dark).

### 4. Memos (Modern Card-flow)
- **Concept**: Comforting slate canvas background containing floating cards, emerald-green highlight badges, and highly breathable layouts.
- **Corner Radius**: Moderate rounded corners: `6px` buttons, `8px` cards, `10px` windows.
- **Accent Primary**: Emerald Green (`#10b981`).
- **Background**: Slate-grey canvas `#f3f4f6` (light) / `#121214` (dark) with pure cards `#ffffff` (light) / `#1e1e24` (dark).

### 5. flomo (Stress-free logs)
- **Concept**: warm creamy water-washed background palette with organic grass green accents, promoting high-frequency stress-free logging.
- **Corner Radius**: Organic large rounded shapes: `8px` buttons, `10px` cards, `12px` windows.
- **Accent Primary**: Grass Green (`#32b67a`).
- **Background**: Warm cream `#f4f4f0` (light) / `#181816` (dark) with cards `#ffffff` (light) / `#252522` (dark).

---

## 4. Layout Rules & Key Components Spec
- **Desktop**: Collapsible clean navigation rail with icons + text labels.
- **Mobile**: Responsive bottom navigation tab bar containing: `首页` (Home), `说说` (Says), `笔记` (Notes), `待办` (Tasks), `更多` (More - opens drawer sidebar).
- **Says (今日说说)**: Thin-bordered timeline cards. Voice Player features a compact volume slider and bouncing EQ waves.
- **Note Editor**: Borderless editing canvas with grouped toolbars. Scrollbars and text selections adjust color palettes automatically based on skin.
