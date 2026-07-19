/**
 * RTE × Yjs 协作扩展脚手架（P2-X · 未默认启用）
 * ---------------------------------------------------------------------------
 * 现状：Yjs 协作主要服务 Markdown/CodeMirror（useYDoc + yCollab）。
 * 目标：TipTap 富文本走 Y.XmlFragment / y-prosemirror。
 *
 * 启用条件（全部满足再开）：
 *   1. 后端 y:sync 协议对 XmlFragment 的 step 回放已回归
 *   2. 与现有 RTE 本地历史/离线队列的冲突策略评审通过
 *   3. feature flag: localStorage `fuyou.rte-yjs=1` 或 workspace feature
 *
 * 本文件仅提供类型与探测函数，不改默认编辑路径。
 */

export const RTE_YJS_FLAG = "fuyou.rte-yjs";

export function isRteYjsEnabled(): boolean {
  try {
    return localStorage.getItem(RTE_YJS_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * 未来接入点（伪代码）：
 *
 * import Collaboration from '@tiptap/extension-collaboration'
 * import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
 * extensions.push(
 *   Collaboration.configure({ document: ydoc }),
 *   CollaborationCursor.configure({ provider, user }),
 * )
 *
 * 与 Markdown 路径共用 SuperYjsProvider，但绑定不同 Y 类型：
 *   - MD: Y.Text('codemirror')
 *   - RTE: Y.XmlFragment('prosemirror')
 */
export type RteYjsBinding = "prosemirror" | "codemirror";

export function recommendedYjsBinding(editorMode: "markdown" | "richtext"): RteYjsBinding {
  return editorMode === "richtext" ? "prosemirror" : "codemirror";
}
