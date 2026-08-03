# Agent rules — Super Note

Instructions for AI coding agents working in this repository.

## UI / UX (required)

When creating or editing **frontend UI, components, pages, modals, drawers, lists, or motion**:

1. **Read** [`frontend/DESIGN.md`](frontend/DESIGN.md) — especially **§11–§16** (Motion Craft).  
   For springs, gestures, and formulas, also use [`frontend/docs/MOTION.md`](frontend/docs/MOTION.md).

2. **Import motion tokens** from `@/lib/motion` — do **not** invent one-off `stiffness`/`damping`/`bounce` values:

   ```ts
   import { springs, variants, rubberband, project } from "@/lib/motion";
   import { Motion } from "@/components/common/Motion";
   ```

3. Prefer **`<Motion.*>`** over bare `framer-motion` `motion.*` so `prefers-reduced-motion` is respected.

4. **Theme is light/dark only** (`next-themes`). Do not reintroduce skins (`data-skin`) or site-wide font pickers. Use system font tokens.

5. Use **semantic tokens only** for new code:
   - Color: `bg-app-*`, `text-tx-*`, `bg-accent-*` / `text-accent-*`
   - Radius: `rounded-button` | `rounded-card` | `rounded-window`
   - Shadow: `shadow-xs` … `shadow-xl`, `shadow-accent`, `shadow-fab`
   - Duration: `duration-press` | `micro` | `fast` | `normal` | `panel` | `sheet`
   - Easing: `ease-out` | `ease-soft` | `ease-inout` | `ease-drawer`
   - Z-index: CSS variables / utilities from DESIGN.md §5 — never new `z-[9999]`

6. **Hard bans**:
   - `transition-all` / `transition: all`
   - Enter animations from `scale(0)` (use ≥ `0.95` + opacity)
   - `ease-in` on UI chrome
   - Animating keyboard-driven or very high-frequency actions (Cmd-K, shortcuts, arrow nav)
   - Locking input for the duration of a transition
   - Hover motion without `@media (hover: hover) and (pointer: fine)`

7. **Fluid gestures** (sheets, drawers, drag-dismiss):
   - 1:1 tracking with pointer capture; keep grab offset
   - Interruptible springs from the **current** on-screen value
   - Boundary: `rubberband()`; flick target: `project()` + snap
   - Hand off release velocity into the spring
   - Honor `[data-swipe-blocker]` for nested horizontal controls

8. **Primitives** to reuse: `@/components/ui/button`, `FeedbackStates`, `PageHeader`, `ContentCanvas`, `AppModal`, **`BottomSheet`** (all mobile bottom sheets — drag + velocity), shell mobile components.

9. **Touch targets** ≥ 44×44px; list rows `min-h-11` / `min-h-12`.

10. Run through the checklist in DESIGN.md **§16.2** before finishing a UI change.

## Product layout (short)

- Mobile tab bar: 笔记 · 任务 · 说说 · 我的 (see DESIGN.md §1 / navigation.config).
- Settings: hash route `#/settings` — not an ad-hoc full-screen hack.
- Page contract: header + one scroll root + FeedbackStates empty/loading/error.

## Out of scope for drive-by edits

- Redesigning skin themes or default fonts
- Mass-migrating every legacy spring without a dedicated task
- Adding new npm animation libraries (use existing `framer-motion`)

## Backend / other

Follow existing patterns in `backend/src` for APIs, auth, and migrations. Prefer minimal diffs. Do not commit secrets.
