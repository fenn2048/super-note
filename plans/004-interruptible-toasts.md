# 004 — Make toasts interruptible (transition, not keyframes)

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1–2 files

## Problem

Toasts use Tailwind `animate-in` (keyframes). Rapid successive toasts cannot retarget mid-flight; stacking feels jumpy.

```tsx
/* frontend/src/components/Toaster.tsx:36-44 — current */
<div
  key={it.id}
  className={cn(
    "pointer-events-auto flex items-center gap-2 px-3.5 py-2.5 rounded-lg shadow-lg w-full",
    "bg-app-elevated border text-sm text-tx-primary",
    "animate-in fade-in slide-in-from-top-2 duration-200",
    ACCENTS[it.type]
  )}
>
```

## Target

Enter/exit along the **same path** (from top), using **CSS transitions** (interruptible), not keyframes:

```tsx
/* target structure */
<div
  key={it.id}
  data-state={it.exiting ? "closed" : "open"}
  className={cn(
    "pointer-events-auto flex items-center gap-2 px-3.5 py-2.5 rounded-lg shadow-lg w-full",
    "bg-app-elevated border text-sm text-tx-primary",
    "transition-[transform,opacity] duration-normal ease-out",
    "data-[state=closed]:opacity-0 data-[state=closed]:-translate-y-2",
    "data-[state=open]:opacity-1 data-[state=open]:translate-y-0",
    ACCENTS[it.type]
  )}
  style={{
    // first paint open from offset without keyframes:
    // use @starting-style if you add a CSS class, or mount with closed then rAF to open
  }}
>
```

Exact timing:

- Duration: **220ms** → Tailwind `duration-normal` / CSS `var(--duration-normal)` (= 220ms)
- Easing: **`cubic-bezier(0.23, 1, 0.32, 1)`** → `ease-out` token / `var(--ease-out)`
- Enter: `opacity: 0; transform: translateY(-8px)` → `opacity: 1; translateY(0)`
- Exit: reverse same path (to `-8px` + opacity 0), not a different direction
- Do **not** use `scale(0)`

Recommended implementation (self-contained):

1. Extend toast item with optional `exiting?: boolean` in `frontend/src/lib/toast.ts` **or** keep dismiss instant if state model is hard — prefer exit animation:
   - On dismiss: mark exiting, wait 220ms, then remove from list.
2. Mount pattern without keyframes:

```tsx
const [shown, setShown] = useState(false);
useEffect(() => {
  const id = requestAnimationFrame(() => setShown(true));
  return () => cancelAnimationFrame(id);
}, []);
// className: shown ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
// plus transition-[transform,opacity] duration-normal ease-out
```

## Repo conventions to follow

- Duration/easing tokens: `frontend/src/lib/motion.ts` (`durations.normal`, `easings.out`) and CSS vars in `frontend/src/index.css`.
- z-index: prefer token (`z-toast` if available) over `z-[9999]` when touching classes — optional cleanup only.
- Exemplar interruptible UI: CSS transitions on buttons (`button.tsx`), not keyframes.

## Steps

1. Read `frontend/src/lib/toast.ts` subscribe/dismiss API.
2. Update `Toaster.tsx` to remove `animate-in fade-in slide-in-from-top-2 duration-200`.
3. Implement mount + optional exit transition as in Target (rAF open state and/or `exiting` flag).
4. Ensure multiple rapid `toast.success()` calls do not restart a single element from zero incorrectly (each toast has its own `key={it.id}` — keep that).
5. Keep icons, accents, dismiss button, and portal position (`top: var(--toast-top)`).

## Boundaries

- Do NOT replace the toast bus with Sonner or another library.
- Do NOT change toast message API (`toast.success` etc.) signatures unless adding optional fields backward-compatibly.
- Do NOT animate width/height of toasts.
- Do NOT add dependencies.

## Verification

- **Mechanical**: `cd frontend && npx tsc --noEmit -p tsconfig.app.json` → exit 0.
- **Feel check**:
  - Fire 5 toasts quickly: each slides from top with ease-out; no “jump restart” mid-flight on the same node.
  - Dismiss one: it exits **upward** (same path), not sideways/down.
  - Animations panel @10%: transition retargets; no `@keyframes` on toast root.
  - `prefers-reduced-motion: reduce`: movement dropped or near-instant; toast still appears.
- **Done when**: no `animate-in` on toast root; enter/exit use transition; typecheck green.
