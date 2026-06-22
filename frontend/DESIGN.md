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


---

## 4. Layout Rules & Key Components Spec
- **Desktop**: Collapsible clean navigation rail with icons + text labels.
- **Mobile**: Responsive bottom navigation tab bar containing: `首页` (Home), `说说` (Says), `笔记` (Notes), `待办` (Tasks), `更多` (More - opens drawer sidebar).
- **Says (今日说说)**: Thin-bordered timeline cards. Voice Player features a compact volume slider and bouncing EQ waves.
- **Note Editor**: Borderless editing canvas with grouped toolbars. Scrollbars and text selections adjust color palettes automatically based on skin.
