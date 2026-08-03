# 001 — Remove high-frequency viewMode page slide

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 1 file, ~10 lines

## Problem

Every main-shell `viewMode` switch (notes ↔ projects ↔ media ↔ diary …) runs a vertical slide via framer-motion. Bottom-tab / NavRail switches happen tens of times per day; motion adds delay and can fight content loading on the main thread.

```tsx
/* frontend/src/App.tsx:1435-1442 — current */
<AnimatePresence mode="wait">
  <motion.div
    key={state.viewMode}
    initial={{ opacity: 0, y: 4 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -4 }}
    transition={springs.snappy}
    className="flex-1 flex flex-col min-h-0 overflow-hidden"
  >
```

## Target

No transform on view switches. Prefer **no animation** (frequency rule). If a crossfade is kept, opacity only, ≤150ms, no `y`:

```tsx
/* target — preferred: no motion */
<div
  key={state.viewMode}
  className="flex-1 flex flex-col min-h-0 overflow-hidden"
>
```

Optional acceptable alternative (only if product insists on a seam softener):

```tsx
/* target — opacity-only, instant feel */
<AnimatePresence mode="wait" initial={false}>
  <motion.div
    key={state.viewMode}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.12 }}
    className="flex-1 flex flex-col min-h-0 overflow-hidden"
  >
```

Use **preferred** (no motion) unless a product owner objects.

## Repo conventions to follow

- High-frequency / keyboard paths: zero animation (see `CommandPalette` — no open/close motion).
- Motion tokens live in `frontend/src/lib/motion.ts`; do not invent new springs for this path.
- Exemplar of “no anim on high frequency”: `frontend/src/components/common/CommandPalette.tsx` (comment: keyboard-first, no enter/exit animation).

## Steps

1. Open `frontend/src/App.tsx`. Locate `AnimatePresence mode="wait"` wrapping `key={state.viewMode}`.
2. Replace the `motion.div` shell with a plain `div` (preferred target). Remove unused `initial` / `animate` / `exit` / `transition` props.
3. If `AnimatePresence` becomes unused for this block only, remove the wrapper; keep other `AnimatePresence` usages in the same file intact.
4. If `motion` is no longer imported for this path but still used elsewhere in `App.tsx`, keep the import; if this was the only use, drop unused imports carefully (do not break other AnimatePresence blocks ~1648+).
5. Confirm `springs` import: if only used here for viewMode, remove unused `springs` import **only if** no other references remain in the file.

## Boundaries

- Do NOT change `viewRegistry`, routing, or tab bar logic.
- Do NOT remove animations from modals, drawers, or music player.
- Do NOT add new dependencies.
- Do NOT reintroduce `y` / `x` motion on this shell.
- If the block structure has drifted since commit `6eb6506`, STOP and report.

## Verification

- **Mechanical**: `cd frontend && npx tsc --noEmit -p tsconfig.app.json` — exit 0.
- **Feel check**:
  - Tap bottom tabs 笔记 → 任务 → 说说 → 我的 repeatedly: content swaps **immediately**, no vertical slide.
  - DevTools Animations panel at 10%: no transform animation on the main content shell when changing tabs.
  - `prefers-reduced-motion: reduce`: still no motion (or only opacity if optional path kept).
- **Done when**: grep shows no `y: 4` / `y: -4` tied to `viewMode` in `App.tsx`.
