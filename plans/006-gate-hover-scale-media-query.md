# 006 — Gate hover:scale behind fine-pointer media query

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: ~15–25 call sites

## Problem

`hover:scale-*` without a fine-pointer media query causes sticky/false hover on touch devices (tap leaves scaled state or flashes scale).

```tsx
/* examples — current */
/* TaskDetailModal.tsx:487 */
"transition-all hover:scale-110 ..."

/* Sidebar.tsx:538 */
"text-base hover:scale-125 transition-transform shrink-0"

/* GlobalMusicPlayer.tsx:1061 */
"hover:scale-110 active:scale-95 transition-transform"
```

## Target

Either remove decorative hover scale, or gate it:

```tsx
/* target — Tailwind arbitrary variant */
"[@media(hover:hover)_and_(pointer:fine)]:hover:scale-105"
```

With transform transition:

```tsx
"transition-transform duration-press ease-out active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:scale-105"
```

Exact values:

- Press: `active:scale-[0.97]` (or keep existing 0.95–0.98 if already present)
- Hover scale: **1.05** preferred for chrome; avoid **1.25** on dense UI (Sidebar emoji can use 1.1 max)
- Duration press: **120ms** → `duration-press`
- Easing: **`ease-out`** → `cubic-bezier(0.23, 1, 0.32, 1)`

Optional CSS helper in `index.css` if repeated often:

```css
@media (hover: hover) and (pointer: fine) {
  .sn-hover-scale:hover {
    transform: scale(1.05);
  }
}
```

## Repo conventions to follow

- Motion craft: `frontend/DESIGN.md` §11 (hover must use fine pointer).
- Button exemplar already uses `active:scale-[0.97]` without ungated hover scale.

## Steps

1. Run: `rg -n "hover:scale" frontend/src --glob '*.tsx'`.
2. For each match under `frontend/src/components` (not node_modules):
   - Prefix hover scale with `[@media(hover:hover)_and_(pointer:fine)]:` **or** remove hover scale if purely decorative and noisy.
   - Ensure `transition-transform` (not `transition-all`) when scale is present.
3. Priority files: `TaskDetailModal.tsx`, `Sidebar.tsx`, `GlobalMusicPlayer.tsx`, `MediaCenter.tsx`, `Dashboard.tsx`, `TagColorPicker.tsx`, `TagColorPopover.tsx`, `TextareaFormatToolbar.tsx`, `MobileMorePage.tsx`, `BookReader.tsx`, `TiptapEditor.tsx`, `DiaryHeatMap.tsx`, `OCRModal.tsx`, `MusicPlayer.tsx`.
4. Do not gate `active:scale` (press feedback must work on touch).

## Boundaries

- Do NOT change layout or hit targets.
- Do NOT remove `active:scale` press feedback.
- Do NOT touch backend.
- Cap extreme scales (1.25) down to ≤1.1 for list/sidebar density unless brand-critical.

## Verification

- **Mechanical**: `rg -n "hover:scale" frontend/src --glob '*.tsx'` — every remaining hover scale is gated with the media query variant (or documented exception).
- **Feel check**:
  - Desktop mouse: hover still scales slightly.
  - Mobile/touch emulator: tap buttons — **no sticky scaled state**.
  - Press still scales down on `:active`.
- **Done when**: no ungated `hover:scale` on interactive chrome; typecheck green.
