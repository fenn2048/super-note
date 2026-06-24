## 2026-06-07 - Enhance Theme Toggle Accessibility
**Learning:** Icon-only toggle button groups are often inaccessible to screen reader and keyboard users without explicit `role="group"`, `aria-pressed`, `aria-label`, and visible focus rings.
**Action:** Always add grouping semantics, explicit labels, pressed states, and `focus-visible` classes to custom toggle groups.

## 2026-06-24 - Harmonize Modal Confirmations
**Learning:** Legacy codebase often mixes native `window.confirm` with custom modal components, leading to visual and accessibility inconsistencies. A Promise-based imperative API for custom modals allows for smooth migration without bloating component state.
**Action:** Prefer using the custom `confirmDialog` utility over native `window.confirm`. Ensure destructive actions use `danger: true` for appropriate visual cues (destructive colors) and default focus on the "Cancel" button to prevent accidental data loss.
