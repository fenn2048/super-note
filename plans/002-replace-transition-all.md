# 002 — Replace transition-all with explicit properties

- **Status**: DONE
- **Commit**: 6eb6506
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: many files (~241 matches under `frontend/src`); phase by traffic

## Problem

`transition-all` animates every property (including layout: width, padding, margin), which forces layout+paint and drops frames on scroll/tap-heavy surfaces.

```tsx
/* example — frontend/src/components/Dashboard.tsx:346 — current pattern */
className="... transition-all shrink-0"
```

```tsx
/* example — frontend/src/components/media/MediaCenter.tsx — many buttons */
className="... transition-all ..."
```

Count at audit time: ~241 occurrences of `transition-all` under `frontend/src`.

## Target

Never use `transition-all` / `transition: all` in new or touched UI code.

Map by intent:

| Intent | Target classes / CSS |
|--------|----------------------|
| Color / bg / border only | `transition-colors duration-fast ease-out` or `duration-fast ease-soft` |
| Transform only (press/hover scale) | `transition-transform duration-press ease-out` |
| Opacity only | `transition-opacity duration-micro ease-out` |
| Mixed color + transform | `transition-[transform,background-color,color,border-color,opacity,box-shadow] duration-press ease-out` |
| Progress width | `transition-[width] duration-panel ease-out` — **not** `all`, not 500ms |

Exact token values (already in `frontend/src/index.css`):

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);
--duration-press: 120ms;
--duration-micro: 160ms;
--duration-fast: 150ms;
--duration-normal: 220ms;
--duration-panel: 280ms;
```

Tailwind maps: `duration-press`, `duration-fast`, `ease-out`, `ease-soft` (see `frontend/tailwind.config.cjs`).

## Repo conventions to follow

- Exemplar (correct): `frontend/src/components/ui/button.tsx:7`

```tsx
"transition-[transform,background-color,color,box-shadow,border-color,filter,opacity] duration-press ease-out ... active:scale-[0.97]"
```

- Exemplar input: `frontend/src/components/ui/input.tsx` uses `transition-[border-color,box-shadow,background-color] duration-fast ease-soft`.
- Do not invent new cubic-beziers.

## Steps

### Phase A — high traffic (do first)

1. Replace `transition-all` in these files (grep and fix every match):
   - `frontend/src/components/Dashboard.tsx`
   - `frontend/src/components/dashboard/DashboardQuickActions.tsx`
   - `frontend/src/components/shell/MobileTabBar.tsx` (if any)
   - `frontend/src/components/Sidebar.tsx`
   - `frontend/src/components/NoteList.tsx`
   - `frontend/src/components/NavRail.tsx`
   - `frontend/src/components/LibraryCenter.tsx`
   - `frontend/src/App.tsx` (if any remain besides intentional padding)
2. For each match, choose the narrowest property set from the Target table.
3. If the element has `active:scale` or `hover:scale`, include `transform` and use `duration-press ease-out`.

### Phase B — modals / media / project

4. Fix: `MediaCenter.tsx`, `GlobalMusicPlayer.tsx`, `MusicPlayer.tsx`, `ProjectCenter.tsx`, `ProjectKanban.tsx`, `TaskDetailModal.tsx`, `DiaryComposeModal.tsx`, `PlanCenter.tsx`, `PlanDetail.tsx`, `ProjectGantt.tsx`.
5. Progress bars with `transition-all duration-500` → `transition-[width] duration-panel ease-out` (max ~280ms, not 500ms).

### Phase C — remainder

6. Run `rg -n "transition-all|transition:\\s*all" frontend/src --glob '*.{tsx,css}'` and clear remaining hits under `frontend/src/components` and `frontend/src/index.css` (skip third-party / `foliate-js` / `node_modules`).
7. Leave `animate-spin` / infinite decorative spins alone (not `transition-all`).

## Boundaries

- Do NOT change colors, layout, or business logic.
- Do NOT touch `backend/`.
- Do NOT “fix” by replacing `transition-all` with empty string (must keep intentional transitions).
- Do NOT add dependencies.
- If a match is inside a comment or string that is not CSS class, leave it.

## Verification

- **Mechanical**:
  - `rg -n "transition-all|transition:\\s*all" frontend/src --glob '*.{tsx,css}'` → zero (or only documented exceptions).
  - `cd frontend && npx tsc --noEmit -p tsconfig.app.json` → exit 0.
- **Feel check**:
  - Scroll note list + tap cards: no janky size animation on hover.
  - Press primary buttons: scale still ~0.97, colors still transition.
  - Chrome Performance: interacting with Dashboard quick actions should not thrash layout from transitions.
- **Done when**: Phase A–C complete; typecheck green; no new visual regressions on buttons/inputs.
