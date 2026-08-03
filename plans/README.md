# Animation improvement plans (improve-animations)

Generated against commit **`6eb6506`**.  
Source audit: Emil Kowalski bar via `improve-animations` skill.  
Product personality: **crisp productivity** (Super Note) — short durations, critically damped springs, no bounce on chrome.

## Status

| # | Plan | Severity | Status | Depends on |
|---|------|----------|--------|------------|
| 001 | [Remove viewMode page slide](./001-remove-viewmode-page-slide.md) | HIGH | DONE | — |
| 002 | [Replace transition-all](./002-replace-transition-all.md) | HIGH | DONE | — |
| 003 | [Migrate high-traffic to Motion.*](./003-migrate-high-traffic-to-Motion.md) | HIGH | DONE | 001 optional |
| 004 | [Interruptible toasts](./004-interruptible-toasts.md) | MEDIUM | DONE | — |
| 005 | [Context menu CSS transition](./005-context-menu-css-transition.md) | MEDIUM | DONE | — |
| 006 | [Gate hover:scale media query](./006-gate-hover-scale-media-query.md) | MEDIUM | DONE | 002 (pairs well) |
| 007 | [Progress bar width transition](./007-progress-bar-transition-width.md) | MEDIUM | DONE | 002 |
| 008 | [List entrance duration / stagger](./008-list-entrance-duration-stagger.md) | LOW | DONE | 003 optional |
| 009 | [Press feedback consistency](./009-press-feedback-consistency.md) | LOW | DONE | 002, 006 |
| 010 | [Missed opportunities soft seams](./010-missed-opportunities-soft-seams.md) | LOW (additive) | DONE | 001, 004 |

## Recommended execution order

1. **001** — highest everyday leverage (every tab switch).  
2. **002** Phase A (Dashboard / Sidebar / NoteList / shell) — performance.  
3. **004** + **005** — toast & menus (can parallelize).  
4. **006** + **007** — touch hover + progress (can parallelize with 004/005).  
5. **003** — reduced-motion shell on high-traffic FM.  
6. **002** Phase B/C — remaining `transition-all`.  
7. **008** + **009** — polish.  
8. **010** — only if polish budget remains.

## Conventions executors must use

| Token | Value |
|-------|--------|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--ease-out-soft` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--duration-press` | `120ms` |
| `--duration-micro` | `160ms` |
| `--duration-fast` | `150ms` |
| `--duration-normal` | `220ms` |
| `--duration-panel` | `280ms` |
| Press scale | `0.97` |
| Enter scale floor | `≥ 0.95` (prefer `0.96–0.97`) |
| Springs | `@/lib/motion` `springs.ui\|sheet\|modal\|snappy\|momentum` only |
| Reduced motion | `@/components/common/Motion` or `useReducedMotion` |

## How to execute

```text
# Hand a single plan file to any coding agent, e.g.:
# “Implement plans/001-remove-viewmode-page-slide.md exactly.”
```

Or: `improve-animations execute plans/001-remove-viewmode-page-slide.md` if that invocation is available.

## Out of scope (do not “fix”)

- Command palette open/close animation (must stay **none**).
- BottomSheet spring / rubberband rewrite (already on-spec).
- Infinite decorative spins (recording EQ, disc spin).
- Theme/skin/font product changes.
