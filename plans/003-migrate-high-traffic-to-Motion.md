# 003 — Migrate high-traffic framer-motion to Motion.* reduced-motion shell

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: ~8–15 files (high-traffic only in this plan)

## Problem

`Motion.tsx` strips transform animations when `prefers-reduced-motion: reduce`. Most of the app still imports bare `motion` from `framer-motion` (~55 component files). Global CSS zeroing of `transition-duration` does **not** stop JS springs.

```tsx
/* frontend/src/components/common/Motion.tsx — intended API */
import { Motion } from "@/components/common/Motion";
<Motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
```

Current coverage: only a few files use `Motion.*` (e.g. `AppModal.tsx`, `MobileDrawer.tsx`).

## Target

High-traffic animated shells use `Motion` tags instead of `motion` tags, keeping the same props:

```tsx
/* target pattern */
import { AnimatePresence } from "framer-motion"; // AnimatePresence stays from framer-motion
import { Motion } from "@/components/common/Motion";
import { springs, variants } from "@/lib/motion";

<AnimatePresence>
  {open && (
    <Motion.div
      variants={variants.fadeScaleIn}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={springs.modal}
    />
  )}
</AnimatePresence>
```

Supported tags on `Motion` (extend only if needed): `div`, `span`, `button`, `section`, `header`, `footer`, `ul`, `li`, `nav`, `aside`, `article`, `main` — see `frontend/src/components/common/Motion.tsx`.

## Repo conventions to follow

- Exemplar: `frontend/src/components/common/AppModal.tsx` (uses `Motion.div` + `springs.modal` + `variants.fadeScaleIn`).
- Exemplar: `frontend/src/components/shell/MobileDrawer.tsx`.
- Keep `AnimatePresence` imported from `framer-motion`.
- Prefer `springs.*` / `variants.*` from `@/lib/motion` when touching transitions.

## Steps

1. **App shell** — `frontend/src/App.tsx`: any remaining `motion.div` for overlays/FAB that still animate; after plan 001, viewMode may be a plain div (skip if no motion left). Migrate other `motion.*` in this file to `Motion.*` if present.
2. **Note list / sidebar navigation-adjacent**:
   - `frontend/src/components/NoteList.tsx` — migrate animated list/item wrappers.
   - `frontend/src/components/Sidebar.tsx` — migrate collapsible / presence motion only.
3. **Dashboard**: `frontend/src/components/Dashboard.tsx` — migrate card enter motions.
4. **Sheets already using motion** (if still bare `motion` inside):
   - `TaskDetailModal.tsx` (desktop shell if any)
   - `MobileTaskCreateModal.tsx` (desktop modal shell)
   - `DiaryComposeModal.tsx` (member selector slide etc.)
5. For each file:
   - Add `import { Motion } from "@/components/common/Motion";`
   - Replace `motion.div` → `Motion.div` (and other supported tags).
   - Keep `AnimatePresence` from `framer-motion`.
   - Remove unused `motion` import if no longer needed.
6. If a tag is missing from `Motion` export (e.g. `motion.a`), either extend `Motion` in `Motion.tsx` with the same `createMotionComponent` pattern, or leave that single tag as bare `motion` with a code comment `// TODO Motion.*`.
7. Do **not** migrate low-traffic marketing-like screens in this plan (Login decorative blobs optional).

## Boundaries

- Do NOT rewrite business logic or layout.
- Do NOT remove reduced-motion CSS in `index.css`.
- Do NOT change `BottomSheet` internals unless it still uses bare `motion` without reduced-motion (if so, migrate inside that file only).
- Do NOT force-migrate all 55 files — this plan is **high-traffic only**. Full-repo migration can be a follow-up.

## Verification

- **Mechanical**: `cd frontend && npx tsc --noEmit -p tsconfig.app.json` → exit 0.
- **Feel check**:
  - Chrome Rendering → “Emulate CSS media feature prefers-reduced-motion: reduce”.
  - Open drawer / modal / dashboard cards: **no slide/scale**; opacity-only or instant is OK.
  - With reduced-motion off: existing enter animations still play.
- **Done when**: App shell + NoteList + Dashboard + key modals use `Motion.*` for animated nodes; typecheck green.
