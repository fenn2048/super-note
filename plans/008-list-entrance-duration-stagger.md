# 008 — Tighten list entrance durations; optional short stagger

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 3–6 files

## Problem

List/group entrances use `animate-in fade-in duration-300` (300ms). For a crisp productivity app this is the upper edge of UI budgets; items often appear all-at-once with no stagger.

```tsx
/* frontend/src/components/ProjectDiscussion.tsx:541 — current */
className="... animate-in fade-in duration-300"
```

Also ~608: `slide-in-from-bottom-4 duration-300`.

## Target

```tsx
/* target — single item */
className="... animate-in fade-in duration-fast"
/* duration-fast = 150ms via CSS var --duration-fast */
```

If using framer-motion list recipes from `frontend/src/lib/motion.ts`:

```tsx
/* target — parent */
variants={variants.listStagger} // staggerChildren: 0.04 (40ms)
/* child */
variants={variants.listItemIn}
transition={springs.snappy} // duration 0.22, bounce 0
```

Rules:

- Stagger delay **30–80ms** between items (repo default 40ms in `listStagger`).
- Stagger must **never** set `pointer-events: none` on the list.
- Prefer opacity + small `y: 8` max; no large slides on dense feeds.
- Cap UI motion ≤300ms; prefer **150–220ms**.

## Repo conventions to follow

- `variants.listItemIn` / `listStagger` / `springs.snappy` in `frontend/src/lib/motion.ts`.
- Personality: quiet productivity — crisp, not bouncy.

## Steps

1. Find: `rg -n "animate-in fade-in duration-300|slide-in-from-bottom.*duration-300" frontend/src/components`.
2. Change `duration-300` → `duration-fast` (150ms) or `duration-normal` (220ms) for denser lists.
3. Optional: for one high-value list (e.g. ProjectDiscussion posts on first paint only), wire `Motion` + `listStagger` / `listItemIn` without blocking clicks.
4. Do not stagger infinite scroll pages item-by-item on every page (janky).

## Boundaries

- Do NOT add bounce to list items.
- Do NOT animate layout height of list containers.
- Do NOT apply stagger to virtualized lists without testing.

## Verification

- **Feel check**: open project discussion — posts appear slightly faster; if stagger added, cascade ~40ms and list is immediately scrollable/tappable.
- **Mechanical**: `tsc` exit 0.
- **Done when**: no unnecessary `duration-300` on dense list entrances in touched files.
