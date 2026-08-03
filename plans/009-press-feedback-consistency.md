# 009 — Consistent press feedback on primary pressables

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: LOW
- **Category**: Physicality & origin
- **Estimated scope**: opportunistic pass on high-traffic pressables

## Problem

Primary `Button` has correct press feedback (`active:scale-[0.97]`), but many custom `<button>` / row pressables only change color or use inconsistent scales (`0.9`, `0.95`, `0.98`, or none).

```tsx
/* frontend/src/components/ui/button.tsx:7 — exemplar (correct) */
"… transition-[transform,…] duration-press ease-out … active:scale-[0.97]"
```

## Target

For custom pressable chrome (not text links, not pure icon that already has scale):

```tsx
className={cn(
  "…",
  "transition-transform duration-press ease-out active:scale-[0.97]",
)}
```

Exact values:

- Scale: **0.97** (allowed range 0.95–0.98)
- Duration: **120ms** → `duration-press`
- Easing: **`ease-out`** → `cubic-bezier(0.23, 1, 0.32, 1)`
- Prefer composing `@/components/ui/button` when the control is a real button.

## Repo conventions to follow

- Prefer `<Button>` from `@/components/ui/button` over one-off class stacks.
- DESIGN.md §11 / §16 press rules.

## Steps

1. High-traffic custom buttons without active scale: Dashboard quick actions, MediaCenter primary rows, Library hub tiles, MobileMorePage tiles, NoteList row actions (if plain buttons).
2. Add `active:scale-[0.97]` + `transition-transform duration-press ease-out` where missing.
3. Normalize extreme `active:scale-[0.9]` on small icons to `0.97` unless intentionally punchier for media transport.
4. Prefer swapping to `<Button variant="…" />` when trivial.

## Boundaries

- Do NOT scale large cards that contain nested interactive children (double-scale feel).
- Do NOT add hover scale here (see plan 006).
- Do NOT change form submit logic.

## Verification

- **Feel check**: tap primary custom buttons on Dashboard / Library / Media — instant press squash ~0.97, release snappy.
- **Mechanical**: `tsc` exit 0.
- **Done when**: high-traffic custom pressables match Button press feel.
