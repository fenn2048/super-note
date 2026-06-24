## 2024-XX-XX - Sidebar Notebook Tree Rendering
**Learning:** `Sidebar.tsx` recursively mapped `NotebookItem` and inline `NoteNoteItem` without `React.memo`, meaning any small state update in the sidebar (like selecting a note, dragging over an item) triggered a full re-render of hundreds of DOM nodes.
**Action:** When building recursive trees in React with potential hundreds of elements (like a notebook hierarchy), always wrap the repeated item components in `React.memo` to skip re-renders when their specific props haven't changed.

## 2026-06-24 - Note Listing Optimization
**Learning:** The main note listing query in the backend was potentially performing full table scans or inefficient index merges because it lacked a composite index covering common filter and sort combinations (userId, workspaceId, isTrashed, isPinned, updatedAt). In the frontend, the `NoteCard` components were re-rendering unnecessarily because event handlers and ref callbacks were created inline, breaking `React.memo` stability.
**Action:** Always add composite indices for primary query paths in the backend. In the frontend, use `useCallback` to stabilize props passed to memoized components in long lists to ensure they actually skip re-renders.
