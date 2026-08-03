# 005 — Context menu: CSS transition instead of keyframes

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: MEDIUM
- **Category**: Interruptibility / Physicality
- **Estimated scope**: 3–4 files

## Problem

Context menus use `@keyframes contextMenuIn`, which restarts from zero if remounted rapidly. Menus should use interruptible transitions and enter from `scale(0.97)`+opacity (not scale 0).

```css
/* frontend/src/index.css:1818-1827 — current */
@keyframes contextMenuIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

```tsx
/* frontend/src/components/ContextMenu.tsx ~81 — current */
style={{
  position: "fixed",
  top: adjustedPos.y,
  left: adjustedPos.x,
  animation: "contextMenuIn 0.12s ease-out",
}}
```

Also used at:

- `frontend/src/components/EditorPane.tsx` (~2222): `animation: "contextMenuIn 0.12s ease-out"`
- `frontend/src/components/CodeBlockView.tsx` (~300, ~378): same

## Target

```css
/* target utility — add near old keyframes, then delete keyframes if unused */
.sn-context-menu-enter {
  opacity: 0;
  transform: scale(0.97);
  transform-origin: var(--sn-menu-origin, top left);
}
.sn-context-menu-enter[data-open="true"] {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity 160ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
```

Or Tailwind-only on the menu root:

```tsx
className={cn(
  "...existing...",
  "origin-top-left transition-[transform,opacity] duration-micro ease-out",
  open ? "opacity-100 scale-100" : "opacity-0 scale-[0.97]",
)}
```

Exact values:

- Duration: **160ms** (`duration-micro` / `--duration-micro: 160ms`) — within tooltip/popover 125–200ms band
- Easing: **`cubic-bezier(0.23, 1, 0.32, 1)`** (`ease-out` token)
- Initial scale: **0.97** (not 0, not only 0.95 without opacity)
- `transform-origin`: toward cursor/trigger if known; else `top left` for LTR menus

## Repo conventions to follow

- Tokens: `frontend/src/index.css` `--duration-micro`, `--ease-out`.
- Popovers scale from trigger when possible; menus often use cursor position — set origin accordingly if coords available.
- Exemplar transitions: `button.tsx` property-specific transitions.

## Steps

1. Update `ContextMenu.tsx`: remove inline `animation: "contextMenuIn..."`.
2. Implement open enter via transition (rAF/`data-open` pattern or CSS class above).
3. Replace the same string in `EditorPane.tsx` and `CodeBlockView.tsx`.
4. Delete `@keyframes contextMenuIn` from `index.css` only after `rg contextMenuIn frontend/src` is empty.
5. Keep positioning (`fixed`, top/left) and semantic colors (`bg-app-elevated`, etc.) unchanged.

## Boundaries

- Do NOT change menu item click handlers or portal logic.
- Do NOT use `scale(0)`.
- Do NOT add framer-motion only for this menu if CSS suffices.
- Do NOT add dependencies.

## Verification

- **Mechanical**: `rg -n "contextMenuIn" frontend/src` → no matches; `tsc` exit 0.
- **Feel check**:
  - Right-click in editor / note list: menu appears with quick ease-out scale from ~0.97.
  - Open/close rapidly: no keyframe restart pop.
  - Animations panel @10%: `transition` on transform/opacity only.
  - Reduced motion: near-instant show is OK.
- **Done when**: keyframes gone; all former call sites use transition; typecheck green.
