## 2026-07-13 - [Tasks] Implemented recurrence offset & recurrence end date
**Learning:**
- Due dates shouldn't be rigidly stored for recurring tasks at the parent template level if the UI needs to differentiate them from the calculated generated task's due date. Instead, it's safer to separate `recurrenceEndDate` and dynamically generate the `remindAt` offset depending on user settings (`reminderOffsetValue`, `reminderOffsetUnit`).
- When introducing offset numbers/units and an overall `recurrenceEndDate`, ensure backward compatibility by falling back to legacy calculation strings when offsets don't exist.
- Always use `isPermanent` state explicitly in the UI to manage whether a `recurrenceEndDate` should be cleared, providing a seamless "Permanent" toggle feature.
- Ensure state bindings match across creation components (`TaskCenter`, `ProjectCenter`, `MobileTaskCreateModal`, and `TaskDetailModal`).

**Action:**
- Updated DB schema (`tasks`, `project_tasks`) with `reminderOffsetValue` (default 1), `reminderOffsetUnit` (default 'day'), and `recurrenceEndDate`.
- Wrote migration v31 to sync the database seamlessly.
- Adapted `getNextOccurrenceString` & backend task routers to respect the offsets using a new `calculateRemindAt` utility, and gracefully halt generation when a recurring task exceeds `recurrenceEndDate`.
- Upgraded the React UI with `ReminderOffsetPicker`, updating various modals and centers to support unit pickers and infinite/permanent toggles properly.
