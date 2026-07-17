# Super-Note UI/UX Design System Reference

## 1. Overview & Positioning
- **Product Positioning**: A lightweight, quiet, family private note-taking, status sharing (Says), and AI knowledge base tool.
- **Design Aesthetic**: Support multiple highly tailored visual languages (skins) allowing users to align the app with their personal workspace vibe.

---

## 2. Roundness & Corner Radii
The global border-radius maps dynamically in `tailwind.config.cjs` using CSS variables (`--radius-button`, `--radius-card`, and `--radius-window` for `md`, `lg`, and `xl`/`2xl` respectively) so that elements adapt instantly when a new skin is selected.

---

## 3. Core Visual Skins

### 1. Obsidian (Default · 护眼纸感 + 浓彩点缀)
- **Concept**: Paper-like workspace for long writing/reading; colorful chrome (nav, FAB, cards) without glare in the editor canvas.
- **Corner Radius**: Soft modern radii — window `14px`, card `12px`, button/input `10px` (overridable per skin).
- **Accent Primary**: Saturated violet (`#b794ff` dark / `#6d4aff` light) with purple→magenta primary gradients.
- **Background**: Warm rice-paper light `#f3efe6` / warm night dark `#16131c`; elevated cream `#fffaf2` / `#252033` (no pure white).
- **Elevation**: Colored soft shadows + multi-hue ambient wash (violet / rose / teal) at viewport corners only.


---

## 4. Layout Rules & Key Components Spec
- **Desktop**: Collapsible clean navigation rail with icons + text labels.
- **Mobile**: Responsive bottom navigation tab bar containing: `首页` (Home), `说说` (Says), `笔记` (Notes), `待办` (Tasks), `更多` (More - opens drawer sidebar).
- **Says (今日说说)**: Thin-bordered timeline cards. Voice Player features a compact volume slider and bouncing EQ waves.
- **Note Editor**: Borderless editing canvas with grouped toolbars. Scrollbars and text selections adjust color palettes automatically based on skin.
