## 2024-XX-XX - Sidebar Notebook Tree Rendering
**Learning:** `Sidebar.tsx` recursively mapped `NotebookItem` and inline `NoteNoteItem` without `React.memo`, meaning any small state update in the sidebar (like selecting a note, dragging over an item) triggered a full re-render of hundreds of DOM nodes.
**Action:** When building recursive trees in React with potential hundreds of elements (like a notebook hierarchy), always wrap the repeated item components in `React.memo` to skip re-renders when their specific props haven't changed.
