# 010 — Missed opportunities: soft seams (additive polish)

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: LOW (additive)
- **Category**: Missed opportunities
- **Estimated scope**: 3–5 files; optional

## Problem

These are **not defects**; they are high-value places that currently teleport and could use restrained motion. Only implement if 001–009 are done or product wants polish now.

### A. Notebook switch in note list

Switching notebooks replaces the list with no fade — can feel like a hard cut.

### B. Toast exit path

Covered primarily by plan 004; ensure enter/exit share direction.

### C. EmptyState first paint

Rare delight budget allows short stagger on empty illustrations/actions.

### D. Settings segmented controls

Theme/language chips swap background without motion.

## Target

### A — Note list notebook switch

```tsx
/* opacity crossfade only, 150ms, no y */
<Motion.div
  key={notebookId}
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.15 }} // 150ms = duration-fast
  className="…"
>
```

Or CSS: `transition-opacity duration-fast ease-out` when `notebookId` changes (remount key).

### C — EmptyState

Use `variants.listStagger` / `listItemIn` from `frontend/src/lib/motion.ts`:

- staggerChildren: **0.04** (40ms)
- child: opacity 0 + `y: 8` → settled
- `springs.snappy` or duration **150–220ms**, bounce **0**
- **Never** `pointer-events: none` for the whole empty state duration

### D — Segmented control

```tsx
/* thumb or active pill */
transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1),
            background-color 150ms cubic-bezier(0.22, 1, 0.36, 1);
```

Prefer `layoutId` spring with `springs.snappy` / `bounce: 0` if already using framer-motion (ThemeToggle already uses `layoutId` — imitate that).

## Repo conventions to follow

- `ThemeToggle.tsx` `layoutId="theme-indicator"` + `springs.snappy` for segmented feel.
- `variants.listStagger` in `@/lib/motion`.
- Frequency: do not animate notebook switch if it becomes noticeable lag — opacity ≤150ms only.

## Steps

1. Only after 001 (viewMode) is done — avoid stacking page fades.
2. NoteList: key list body by `selectedNotebookId`; opacity-only enter via `Motion` or CSS.
3. `FeedbackStates` empty: optional 40ms stagger on icon + title + action.
4. Settings appearance chips: ensure active pill uses `layoutId` or transform transition (ThemeToggle is the exemplar).
5. Skip if reduced-motion: opacity only or instant.

## Boundaries

- Do NOT add confetti / bounce celebrations.
- Do NOT slide entire note list by >8px.
- Do NOT block interaction during stagger.
- Optional plan — skip entirely if time-boxed to corrective work only.

## Verification

- **Feel check**: switch notebooks — soft 150ms fade, not a slide; empty state cascade is subtle; theme chips morph without jump.
- **Mechanical**: `tsc` exit 0.
- **Done when**: at least A or C shipped with reduced-motion safe behavior, or plan marked CANCELLED with reason.
