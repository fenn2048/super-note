# 007 — Progress bars: width-only transition, ≤280ms

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: MEDIUM
- **Category**: Easing & duration / Performance
- **Estimated scope**: 4–6 files

## Problem

Progress fills use `transition-all duration-500`, which is slow for UI and animates unnecessary properties.

```tsx
/* frontend/src/components/PlanCenter.tsx:308 — current pattern */
className="h-full bg-accent-primary rounded-full transition-all duration-500"
```

Same pattern appears in:

- `frontend/src/components/ProjectCenter.tsx` (~3090)
- `frontend/src/components/PlanDetail.tsx` (~507)
- `frontend/src/components/ProjectGantt.tsx` (~201) (`transition-all duration-500`)

## Target

```tsx
/* target */
className="h-full bg-accent-primary rounded-full transition-[width] duration-panel ease-out"
```

Exact values:

- Property: **`width` only** (or `transform: scaleX` if the bar uses transform — prefer matching existing width style)
- Duration: **280ms** → `duration-panel` / `--duration-panel: 280ms` (UI under 300ms)
- Easing: **`cubic-bezier(0.23, 1, 0.32, 1)`** → `ease-out`

If the fill is driven by `style={{ width: `${p}%` }}`, `transition-[width]` is correct. If it uses `scaleX`, use `transition-transform` instead.

## Repo conventions to follow

- Duration token `duration-panel` in `frontend/tailwind.config.cjs` → `var(--duration-panel)`.
- Do not use bounce springs on progress bars.

## Steps

1. `rg -n "duration-500|transition-all duration" frontend/src/components --glob '*.tsx' | rg -i "progress|h-full bg-accent|rounded-full"`.
2. Replace each progress fill’s `transition-all duration-500` with `transition-[width] duration-panel ease-out` (or transform equivalent).
3. Leave indeterminate spinners (`animate-spin`) unchanged.

## Boundaries

- Do NOT change progress calculation logic.
- Do NOT animate layout of parent cards.
- Do NOT set duration > 300ms on these fills.

## Verification

- **Mechanical**: no `transition-all duration-500` on progress fills; `tsc` exit 0.
- **Feel check**: change task/plan progress — bar eases to new width in ~280ms, not a half-second crawl; no layout thrash.
- **Done when**: all listed progress bars updated.
