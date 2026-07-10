import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BrainCircuit, Plus, Trash2, Edit2,
  ZoomIn, ZoomOut, Maximize2,
  Loader2, Check, Map, Menu, PanelLeftClose, Image, FileImage, FileDown,
  User as UserIcon
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, getCurrentWorkspace } from "@/lib/api";
import { MindMap, MindMapListItem, MindMapNode, MindMapData } from "@/types";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/downloadFile";
import VisibilityToggle from "@/components/common/VisibilityToggle";

/* ===== 布局算法：计算树节点的 x,y 位置 ===== */
interface LayoutNode {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  collapsed: boolean;
  children: LayoutNode[];
  parent: LayoutNode | null;
  side?: "left" | "right";
}

const NODE_H = 36;
const NODE_MIN_W = 80;
const NODE_CHAR_W = 14;
const H_GAP = 50;
const V_GAP = 12;

function measureNode(text: string): { width: number; height: number } {
  const w = Math.max(NODE_MIN_W, Math.min(text.length * NODE_CHAR_W + 32, 260));
  return { width: w, height: NODE_H };
}

function buildLayout(node: MindMapNode, depth: number, parent: LayoutNode | null): LayoutNode {
  const { width, height } = measureNode(node.text);
  const ln: LayoutNode = {
    id: node.id,
    text: node.text,
    x: 0,
    y: 0,
    width,
    height,
    depth,
    collapsed: !!node.collapsed,
    children: [],
    parent,
  };
  if (!node.collapsed && node.children) {
    ln.children = node.children.map((c) => buildLayout(c, depth + 1, ln));
  }
  return ln;
}

function getSubtreeHeight(node: LayoutNode): number {
  if (node.children.length === 0) return node.height;
  let total = 0;
  node.children.forEach((c, i) => {
    total += getSubtreeHeight(c);
    if (i > 0) total += V_GAP;
  });
  return Math.max(node.height, total);
}

function getSubtreeWidth(node: LayoutNode): number {
  if (node.children.length === 0) return node.width;
  let total = 0;
  node.children.forEach((c, i) => {
    total += getSubtreeWidth(c);
    if (i > 0) total += H_GAP;
  });
  return Math.max(node.width, total);
}

// 1. 逻辑图 & 思维导图布局
function layoutLogical(root: LayoutNode, structure: string) {
  root.x = 0;
  root.y = -root.height / 2;
  
  if (root.children.length === 0) return;

  if (structure === "mindmap") {
    // 左右分布
    const rightChildren = root.children.filter((_, i) => i % 2 === 0);
    const leftChildren = root.children.filter((_, i) => i % 2 !== 0);

    if (rightChildren.length > 0) {
      const totalH = rightChildren.reduce(
        (sum, c, i) => sum + getSubtreeHeight(c) + (i > 0 ? V_GAP : 0),
        0
      );
      let cy = 0 - totalH / 2;
      rightChildren.forEach((c) => {
        const ch = getSubtreeHeight(c);
        layoutSubtreeLogical(c, root.width + H_GAP, cy + ch / 2, "right");
        cy += ch + V_GAP;
      });
    }

    if (leftChildren.length > 0) {
      const totalH = leftChildren.reduce(
        (sum, c, i) => sum + getSubtreeHeight(c) + (i > 0 ? V_GAP : 0),
        0
      );
      let cy = 0 - totalH / 2;
      leftChildren.forEach((c) => {
        const ch = getSubtreeHeight(c);
        layoutSubtreeLogical(c, -(root.width + H_GAP), cy + ch / 2, "left");
        cy += ch + V_GAP;
      });
    }
  } else if (structure === "left-logical" || structure === "left-brace-map") {
    // 向左逻辑图
    const totalH = root.children.reduce(
      (sum, c, i) => sum + getSubtreeHeight(c) + (i > 0 ? V_GAP : 0),
      0
    );
    let cy = 0 - totalH / 2;
    root.children.forEach((c) => {
      const ch = getSubtreeHeight(c);
      layoutSubtreeLogical(c, -(root.width + H_GAP), cy + ch / 2, "left");
      cy += ch + V_GAP;
    });
  } else {
    // 默认向右逻辑图/括号图
    const totalH = root.children.reduce(
      (sum, c, i) => sum + getSubtreeHeight(c) + (i > 0 ? V_GAP : 0),
      0
    );
    let cy = 0 - totalH / 2;
    root.children.forEach((c) => {
      const ch = getSubtreeHeight(c);
      layoutSubtreeLogical(c, root.width + H_GAP, cy + ch / 2, "right");
      cy += ch + V_GAP;
    });
  }
}

function layoutSubtreeLogical(node: LayoutNode, x: number, yCenter: number, side: "left" | "right") {
  node.side = side;
  if (side === "left") {
    node.x = x - node.width;
  } else {
    node.x = x;
  }
  node.y = yCenter - node.height / 2;

  if (node.children.length === 0) return;

  const childX = side === "left" ? x - node.width - H_GAP : x + node.width + H_GAP;
  const totalH = node.children.reduce(
    (sum, c, i) => sum + getSubtreeHeight(c) + (i > 0 ? V_GAP : 0),
    0
  );
  let cy = yCenter - totalH / 2;
  node.children.forEach((c) => {
    const ch = getSubtreeHeight(c);
    layoutSubtreeLogical(c, childX, cy + ch / 2, side);
    cy += ch + V_GAP;
  });
}

// 2. 垂直/分类图布局
function layoutVertical(root: LayoutNode, structure: string) {
  const isUp = structure === "up-classification";
  root.x = -root.width / 2;
  root.y = 0;

  layoutSubtreeVertical(root, 0, 0, isUp ? -1 : 1);
}

function layoutSubtreeVertical(node: LayoutNode, xCenter: number, y: number, dir: 1 | -1) {
  node.x = xCenter - node.width / 2;
  node.y = y;

  if (node.children.length === 0) return;

  const childY = y + dir * (node.height + V_GAP * 2.5);
  const totalW = node.children.reduce(
    (sum, c, i) => sum + getSubtreeWidth(c) + (i > 0 ? H_GAP : 0),
    0
  );
  let cx = xCenter - totalW / 2;
  node.children.forEach((c) => {
    const cw = getSubtreeWidth(c);
    layoutSubtreeVertical(c, cx + cw / 2, childY, dir);
    cx += cw + H_GAP;
  });
}

// 3. 气泡图布局
function layoutBubbleMap(root: LayoutNode) {
  root.x = -root.width / 2;
  root.y = -root.height / 2;

  if (root.children.length === 0) return;

  const R = 150 + root.children.length * 10;
  root.children.forEach((c, i) => {
    const angle = (i * 2 * Math.PI) / root.children.length;
    c.x = R * Math.cos(angle) - c.width / 2;
    c.y = R * Math.sin(angle) - c.height / 2;
    
    if (c.children.length > 0) {
      const subR = 85;
      c.children.forEach((sc, j) => {
        const subAngle = angle + ((j - (c.children.length - 1) / 2) * Math.PI) / 6;
        sc.x = c.x + c.width / 2 + subR * Math.cos(subAngle) - sc.width / 2;
        sc.y = c.y + c.height / 2 + subR * Math.sin(subAngle) - sc.height / 2;
      });
    }
  });
}

// 4. 双气泡图布局
function layoutDoubleBubble(root: LayoutNode) {
  root.x = -180 - root.width / 2;
  root.y = -root.height / 2;

  if (root.children.length === 0) return;

  const rootB = root.children[0];
  rootB.x = 180 - rootB.width / 2;
  rootB.y = -rootB.height / 2;

  const remainingChildren = root.children.slice(1);
  if (remainingChildren.length === 0) return;

  const shared: LayoutNode[] = [];
  const aOnly: LayoutNode[] = [];
  const bOnly: LayoutNode[] = [];

  remainingChildren.forEach((c, i) => {
    if (c.text.includes("共享") || c.text.includes("Shared") || i % 3 === 0) {
      shared.push(c);
    } else if (i % 2 === 0) {
      aOnly.push(c);
    } else {
      bOnly.push(c);
    }
  });

  if (shared.length > 0) {
    const startY = -((shared.length - 1) * 80) / 2;
    shared.forEach((c, i) => {
      c.x = -c.width / 2;
      c.y = startY + i * 80 - c.height / 2;
    });
  }

  if (aOnly.length > 0) {
    aOnly.forEach((c, i) => {
      const angle = Math.PI - (Math.PI / 3) + (i * (2 * Math.PI / 3)) / Math.max(1, aOnly.length - 1);
      c.x = root.x + root.width / 2 + 130 * Math.cos(angle) - c.width / 2;
      c.y = root.y + root.height / 2 + 130 * Math.sin(angle) - c.height / 2;
    });
  }

  if (bOnly.length > 0) {
    bOnly.forEach((c, i) => {
      const angle = -(Math.PI / 3) + (i * (2 * Math.PI / 3)) / Math.max(1, bOnly.length - 1);
      c.x = rootB.x + rootB.width / 2 + 130 * Math.cos(angle) - c.width / 2;
      c.y = rootB.y + rootB.height / 2 + 130 * Math.sin(angle) - c.height / 2;
    });
  }
}

// 5. 鱼骨图布局
function layoutFishbone(root: LayoutNode) {
  root.x = 250;
  root.y = -root.height / 2;

  if (root.children.length === 0) return;

  root.children.forEach((c, i) => {
    const isTop = i % 2 === 0;
    const xPos = 120 - Math.floor(i / 2) * 160;
    const slantY = isTop ? -130 : 130;
    c.x = xPos - c.width / 2;
    c.y = slantY - c.height / 2;

    if (c.children.length > 0) {
      c.children.forEach((sc, j) => {
        sc.x = c.x + (isTop ? -sc.width - 20 : c.width + 20);
        sc.y = c.y + (j - (c.children.length - 1) / 2) * 45;
      });
    }
  });
}

// 6. 横向时间轴布局
function layoutHorizontalTimeline(root: LayoutNode) {
  root.x = 0;
  root.y = -root.height / 2;

  if (root.children.length === 0) return;

  let currentX = root.width + 80;
  root.children.forEach((c, i) => {
    c.x = currentX;
    c.y = (i % 2 === 0 ? -90 : 90) - c.height / 2;

    if (c.children.length > 0) {
      c.children.forEach((sc, j) => {
        sc.x = c.x + (j + 1) * 60;
        sc.y = c.y + (i % 2 === 0 ? -40 : 40);
      });
    }
    currentX += c.width + 120;
  });
}

// 7. 竖向时间轴布局
function layoutVerticalTimeline(root: LayoutNode) {
  root.x = -root.width / 2;
  root.y = 0;

  if (root.children.length === 0) return;

  let currentY = root.height + 60;
  root.children.forEach((c, i) => {
    c.y = currentY;
    c.x = (i % 2 === 0 ? -160 : 60);

    if (c.children.length > 0) {
      c.children.forEach((sc, j) => {
        sc.x = c.x + (i % 2 === 0 ? -120 : 120);
        sc.y = c.y + j * 45;
      });
    }
    currentY += c.height + 80;
  });
}

// 8. 圆圈图布局
function layoutCircleMap(root: LayoutNode) {
  root.x = -root.width / 2;
  root.y = -root.height / 2;

  if (root.children.length === 0) return;

  const firstCircle = root.children.slice(0, 6);
  firstCircle.forEach((c, i) => {
    const angle = (i * 2 * Math.PI) / firstCircle.length;
    c.x = 120 * Math.cos(angle) - c.width / 2;
    c.y = 120 * Math.sin(angle) - c.height / 2;
  });

  const secondCircle = root.children.slice(6);
  if (secondCircle.length > 0) {
    secondCircle.forEach((c, i) => {
      const angle = (i * 2 * Math.PI) / secondCircle.length;
      c.x = 220 * Math.cos(angle) - c.width / 2;
      c.y = 220 * Math.sin(angle) - c.height / 2;
    });
  }
}

// 9. 流程图布局
function layoutFlowchart(root: LayoutNode) {
  root.x = -root.width / 2;
  root.y = 0;

  if (root.children.length === 0) return;

  let currentY = root.height + 60;
  root.children.forEach((c) => {
    c.x = -c.width / 2;
    c.y = currentY;

    if (c.children.length > 0) {
      const totalW = (c.children.length - 1) * 160;
      c.children.forEach((sc, j) => {
        sc.x = -totalW / 2 + j * 160 - sc.width / 2;
        sc.y = currentY + c.height + 60;
      });
    }
    currentY += c.height + 120;
  });
}

// 10. 桥形图布局
function layoutBridgeMap(root: LayoutNode) {
  root.x = -root.width / 2;
  root.y = 60;

  if (root.children.length === 0) return;

  root.children.forEach((c, i) => {
    c.x = (i + 1) * 220 - c.width / 2;
    c.y = 60;

    if (c.children.length > 0) {
      c.children.forEach((sc, j) => {
        sc.x = c.x;
        sc.y = -60 - j * 45;
      });
    }
  });
}

// 统一布局应用入口
function applyLayout(root: LayoutNode, structure: string) {
  if (
    structure === "right-logical" ||
    structure === "left-logical" ||
    structure === "mindmap" ||
    structure === "brace-map" ||
    structure === "left-brace-map"
  ) {
    layoutLogical(root, structure);
  } else if (
    structure === "org-chart" ||
    structure === "down-classification" ||
    structure === "up-classification"
  ) {
    layoutVertical(root, structure);
  } else if (structure === "bubble-map") {
    layoutBubbleMap(root);
  } else if (structure === "double-bubble") {
    layoutDoubleBubble(root);
  } else if (structure === "fishbone") {
    layoutFishbone(root);
  } else if (structure === "h-timeline") {
    layoutHorizontalTimeline(root);
  } else if (structure === "v-timeline") {
    layoutVerticalTimeline(root);
  } else if (structure === "circle-map") {
    layoutCircleMap(root);
  } else if (
    structure === "flowchart" ||
    structure === "multi-flowchart"
  ) {
    layoutFlowchart(root);
  } else if (structure === "bridge-map") {
    layoutBridgeMap(root);
  } else {
    // 默认回滚
    root.x = 0;
    root.y = -root.height / 2;
    if (root.children.length > 0) {
      const childX = root.width + H_GAP;
      const totalH = root.children.reduce(
        (sum, c, i) => sum + getSubtreeHeight(c) + (i > 0 ? V_GAP : 0),
        0
      );
      let cy = 0 - totalH / 2;
      root.children.forEach((c) => {
        const ch = getSubtreeHeight(c);
        layoutSubtreeLogical(c, childX, cy + ch / 2, "right");
        cy += ch + V_GAP;
      });
    }
  }
}

/* ===== 大纲编辑器数据操作辅助函数 ===== */
function addOutlineSibling(root: MindMapNode, targetId: string): MindMapNode {
  if (targetId === "root") {
    const newId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return { ...root, children: [...root.children, { id: newId, text: "", children: [] }] };
  }
  const idx = root.children.findIndex((c) => c.id === targetId);
  if (idx !== -1) {
    const newId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nextChildren = [...root.children];
    nextChildren.splice(idx + 1, 0, { id: newId, text: "", children: [] });
    return { ...root, children: nextChildren };
  }
  return {
    ...root,
    children: root.children.map((c) => addOutlineSibling(c, targetId)),
  };
}

function indentOutlineNode(root: MindMapNode, targetId: string): MindMapNode {
  const idx = root.children.findIndex((c) => c.id === targetId);
  if (idx > 0) {
    const preceding = root.children[idx - 1];
    const target = root.children[idx];
    const nextChildren = root.children.filter((c) => c.id !== targetId);
    nextChildren[idx - 1] = {
      ...preceding,
      children: [...preceding.children, target],
    };
    return { ...root, children: nextChildren };
  }
  return {
    ...root,
    children: root.children.map((c) => indentOutlineNode(c, targetId)),
  };
}

function outdentOutlineNode(root: MindMapNode, targetId: string): { root: MindMapNode; success: boolean } {
  for (let i = 0; i < root.children.length; i++) {
    const parent = root.children[i];
    const childIdx = parent.children.findIndex((c) => c.id === targetId);
    if (childIdx !== -1) {
      const targetNode = parent.children[childIdx];
      const nextParentChildren = parent.children.filter((c) => c.id !== targetId);
      const nextRootChildren = [...root.children];
      nextRootChildren[i] = { ...parent, children: nextParentChildren };
      nextRootChildren.splice(i + 1, 0, targetNode);
      return { root: { ...root, children: nextRootChildren }, success: true };
    }
  }
  let success = false;
  const nextChildren = root.children.map((c) => {
    if (success) return c;
    const res = outdentOutlineNode(c, targetId);
    if (res.success) {
      success = true;
      return res.root;
    }
    return c;
  });
  return { root: { ...root, children: nextChildren }, success };
}

function flattenNodes(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  node.children.forEach((c) => result.push(...flattenNodes(c)));
  return result;
}

/* ===== 颜色方案 ===== */
const DEPTH_COLORS = [
  { bg: "var(--color-accent-primary)", text: "#fff", border: "color-mix(in srgb, var(--color-accent-primary) 85%, black)" },       // root
  { bg: "color-mix(in srgb, var(--color-accent-primary) 12%, var(--color-bg, #ffffff))", text: "var(--color-text-primary, #1a1a1a)", border: "color-mix(in srgb, var(--color-accent-primary) 35%, var(--color-bg, #ffffff))" }, // tier 1
  { bg: "color-mix(in srgb, var(--color-accent-primary) 6%, var(--color-bg, #ffffff))", text: "var(--color-text-secondary, #5a5a5a)", border: "color-mix(in srgb, var(--color-accent-primary) 20%, var(--color-bg, #ffffff))" }, // tier 2
];

function getNodeColor(depth: number) {
  return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];
}

function resolveCssColor(colorStr: string): string {
  if (!colorStr.includes("var") && !colorStr.includes("color-mix")) {
    return colorStr;
  }
  try {
    const tempEl = document.createElement("div");
    tempEl.style.display = "none";
    tempEl.style.color = colorStr;
    document.body.appendChild(tempEl);
    const computedColor = window.getComputedStyle(tempEl).color;
    document.body.removeChild(tempEl);
    return computedColor || colorStr;
  } catch {
    return colorStr;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* ===== CRC-32（用于 ZIP 打包） ===== */
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* ===== 连线路径计算 ===== */
function getEdgePath(from: LayoutNode, to: LayoutNode, structure: string): string {
  const isLeft = to.side === "left";
  const x1 = isLeft ? from.x : from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = isLeft ? to.x + to.width : to.x;
  const y2 = to.y + to.height / 2;
  const mx = (x1 + x2) / 2;

  if (structure === "bubble-map" || structure === "double-bubble" || structure === "circle-map") {
    return `M${x1},${y1} L${x2},${y2}`;
  } else if (
    structure === "org-chart" ||
    structure === "down-classification" ||
    structure === "up-classification" ||
    structure === "flowchart" ||
    structure === "multi-flowchart"
  ) {
    const midY = (y1 + y2) / 2;
    const px = from.x + from.width / 2;
    const py = y1 + (structure === "up-classification" ? -from.height / 2 : from.height / 2);
    const cx = to.x + to.width / 2;
    const cy = y2 + (structure === "up-classification" ? to.height / 2 : -to.height / 2);
    return `M${px},${py} V${midY} H${cx} V${cy}`;
  } else if (structure === "brace-map" || structure === "left-brace-map") {
    const braceX = x1 + (isLeft ? -15 : 15);
    return `M${x1},${y1} H${braceX} V${y2} H${x2}`;
  } else if (structure === "fishbone") {
    return `M${x1},${y1} L${x2},${y2}`;
  } else {
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }
}

/* ===== 连线组件 ===== */
function Edge({ from, to, structure }: { from: LayoutNode; to: LayoutNode; structure: string }) {
  const pathData = getEdgePath(from, to, structure);
  const isFlow = structure === "flowchart" || structure === "multi-flowchart";

  return (
    <path
      d={pathData}
      fill="none"
      stroke="rgb(203,213,225)"
      strokeWidth={2}
      className="dark:stroke-zinc-600 transition-all duration-300"
      markerEnd={isFlow ? "url(#arrow)" : undefined}
    />
  );
}

/* ===== 节点组件 ===== */
function NodeBox({
  node, isSelected, isEditing, editValue,
  onSelect, onDoubleClick, onEditChange, onEditSubmit,
  onToggleCollapse, onAddChild, onDelete, isMobile, onContextMenu,
}: {
  node: LayoutNode;
  isSelected: boolean;
  isEditing: boolean;
  editValue: string;
  onSelect: () => void;
  onDoubleClick: () => void;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onToggleCollapse: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  isMobile: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const color = getNodeColor(node.depth);
  const isRoot = node.depth === 0;
  const hasChildren = node.children.length > 0 || node.collapsed;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <g>
      <foreignObject x={node.x} y={node.y} width={node.width} height={node.height}>
        <div
          className={cn(
            "flex items-center h-full px-3 rounded-lg cursor-pointer select-none transition-shadow text-sm font-medium whitespace-nowrap overflow-hidden",
            isSelected && "ring-2 ring-accent-primary ring-offset-1 dark:ring-offset-zinc-900"
          )}
          style={{
            background: color.bg,
            color: color.text,
            border: `1.5px solid ${color.border}`,
            fontSize: isRoot ? 14 : 13,
            fontWeight: isRoot ? 700 : 500,
          }}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
          onContextMenu={onContextMenu}
          onTouchStart={(e) => {
            if (isMobile) {
              longPressTimer.current = setTimeout(() => {
                e.stopPropagation();
                onSelect();
                onDoubleClick();
              }, 500);
            }
          }}
          onTouchEnd={() => {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }}
          onTouchMove={() => {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }}
        >
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onEditSubmit();
                if (e.key === "Escape") onEditSubmit();
              }}
              onBlur={onEditSubmit}
              className="flex-1 bg-transparent outline-none text-inherit min-w-0"
              style={{ fontSize: "inherit", fontWeight: "inherit" }}
            />
          ) : (
            <span className="truncate">{node.text}</span>
          )}
        </div>
      </foreignObject>

      {/* 折叠/展开按钮 */}
      {hasChildren && !isEditing && (
        <foreignObject
          x={node.x + node.width - 2}
          y={node.y + node.height / 2 - 10}
          width={20}
          height={20}
        >
          <div
            className="w-5 h-5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
          >
            {node.collapsed ? (
              <Plus size={10} className="text-zinc-500" />
            ) : (
              <span className="text-zinc-500 text-[10px] font-bold">−</span>
            )}
          </div>
        </foreignObject>
      )}

      {/* 选中时的操作按钮 */}
      {isSelected && !isEditing && (
        <foreignObject
          x={node.x}
          y={node.y + node.height + 4}
          width={node.width + 40}
          height={isMobile ? 36 : 28}
        >
          <div className="flex items-center gap-1">
            <button
              className={cn(
                "flex items-center gap-1 rounded bg-accent-primary text-white hover:opacity-90 transition-colors",
                isMobile ? "px-3 py-2 text-xs" : "px-2 py-1 text-[11px]"
              )}
              onClick={(e) => { e.stopPropagation(); onAddChild(); }}
            >
              <Plus size={isMobile ? 14 : 10} />
            </button>
            <button
              className={cn(
                "flex items-center gap-1 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors",
                isMobile ? "px-3 py-2 text-xs" : "px-2 py-1 text-[11px]"
              )}
              onClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
            >
              <Edit2 size={isMobile ? 14 : 10} />
            </button>
            {!isRoot && (
              <button
                className={cn(
                  "flex items-center gap-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors",
                  isMobile ? "px-3 py-2 text-xs" : "px-2 py-1 text-[11px]"
                )}
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                <Trash2 size={isMobile ? 14 : 10} />
              </button>
            )}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

/* ===== 列表项组件 ===== */
function MindMapListRow({
  item, isActive, onSelect, onDelete, onContextMenu,
}: {
  item: MindMapListItem;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const date = new Date(item.updatedAt + (item.updatedAt.endsWith("Z") ? "" : "Z"));
  const dateStr = date.toLocaleDateString();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 工作区下展示创建者（与 Note/Task/Diary 一致）。User 图标本身具语义，
  // 此处不再额外加 i18n 文案前缀，节省横向空间。
  const showCreator =
    !!item.creatorName && getCurrentWorkspace() !== "personal";

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3 rounded-lg border transition-all cursor-pointer",
        isActive
          ? "border-accent-primary/40 dark:border-accent-primary/70 bg-accent-primary/5 dark:bg-accent-primary/10"
          : "border-app-border bg-app-elevated hover:shadow-md hover:border-accent-primary/30 dark:hover:border-accent-primary/55"
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onTouchStart={(e) => {
        longPressTimer.current = setTimeout(() => {
          // 长按触发右键菜单（移动端导出入口）
          const touch = e.touches[0];
          if (touch) {
            const syntheticEvent = {
              preventDefault: () => {},
              stopPropagation: () => {},
              clientX: touch.clientX,
              clientY: touch.clientY,
            } as React.MouseEvent;
            onContextMenu(syntheticEvent);
          }
        }, 600);
      }}
      onTouchEnd={() => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }}
      onTouchMove={() => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }}
    >
      <BrainCircuit size={18} className="text-accent-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-tx-primary truncate">{item.title}</div>
        <div className="flex items-center gap-2 text-xs text-tx-tertiary mt-0.5 min-w-0">
          <span className="shrink-0">{dateStr}</span>
          {showCreator && (
            <>
              <span className="text-tx-tertiary/60 shrink-0">·</span>
              <span
                className="flex items-center gap-1 truncate"
                title={item.creatorName ?? ""}
              >
                <UserIcon size={11} className="shrink-0" />
                <span className="truncate">{item.creatorName}</span>
              </span>
            </>
          )}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-tx-tertiary hover:text-accent-danger transition-all flex-shrink-0"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/* ===== 大纲节点组件 ===== */
function OutlineNodeItem({
  node,
  onUpdateText,
  onAddSibling,
  onIndent,
  onOutdent,
  onDelete,
  depth,
}: {
  node: MindMapNode;
  onUpdateText: (id: string, text: string) => void;
  onAddSibling: (id: string) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onDelete: (id: string) => void;
  depth: number;
}) {
  return (
    <div className="flex flex-col" style={{ paddingLeft: depth > 0 ? 20 : 0 }}>
      <div className="flex items-center gap-2 py-1.5 group">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0 opacity-70" />
        <input
          value={node.text}
          onChange={(e) => onUpdateText(node.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddSibling(node.id);
            } else if (e.key === "Tab") {
              e.preventDefault();
              if (e.shiftKey) {
                onOutdent(node.id);
              } else {
                onIndent(node.id);
              }
            } else if (e.key === "Backspace" && node.text === "") {
              e.preventDefault();
              onDelete(node.id);
            }
          }}
          className="flex-1 bg-transparent outline-none border-b border-transparent focus:border-accent-primary/30 text-sm py-0.5 text-tx-primary font-medium"
          placeholder="新建节点..."
        />
        <button
          onClick={() => onAddSibling(node.id)}
          className="opacity-0 group-hover:opacity-100 text-tx-tertiary hover:text-accent-primary transition-opacity text-xs p-1"
          title="添加同级"
        >
          <Plus size={13} />
        </button>
        <button
          onClick={() => onDelete(node.id)}
          className="opacity-0 group-hover:opacity-100 text-tx-tertiary hover:text-red-500 transition-opacity text-xs p-1"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {node.children &&
        node.children.map((c) => (
          <OutlineNodeItem
            key={c.id}
            node={c}
            depth={depth + 1}
            onUpdateText={onUpdateText}
            onAddSibling={onAddSibling}
            onIndent={onIndent}
            onOutdent={onOutdent}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

const BLANK_STRUCTURES = [
  { id: "mindmap", name: "思维导图" },
  { id: "right-logical", name: "向右逻辑图" },
  { id: "left-logical", name: "向左逻辑图" },
  { id: "org-chart", name: "组织结构图" },
  { id: "down-classification", name: "向下分类图" },
  { id: "up-classification", name: "向上分类图" },
  { id: "fishbone", name: "鱼骨图" },
  { id: "h-timeline", name: "横向时间轴" },
  { id: "v-timeline", name: "竖向时间轴" },
  { id: "bubble-map", name: "气泡图" },
  { id: "double-bubble", name: "双气泡图" },
  { id: "brace-map", name: "括号图" },
  { id: "left-brace-map", name: "向左括号图" },
  { id: "flowchart", name: "基础流程图" },
  { id: "multi-flowchart", name: "复流程图" },
  { id: "bridge-map", name: "桥形图" },
  { id: "outline", name: "大纲" }
];

const PRESET_TEMPLATES = [
  {
    id: "weekly-plan",
    name: "一周工作计划",
    category: "work",
    structure: "mindmap",
    rootText: "一周工作计划",
    children: [
      { text: "周一 (Monday)", children: [{ text: "核心工作 1" }, { text: "日常例会" }] },
      { text: "周二 (Tuesday)", children: [{ text: "核心工作 2" }] },
      { text: "周三 (Wednesday)", children: [{ text: "核心工作 3" }] },
      { text: "周四 (Thursday)", children: [{ text: "进度检查" }] },
      { text: "周五 (Friday)", children: [{ text: "周报与总结" }] }
    ]
  },
  {
    id: "meeting-minutes",
    name: "会议记录",
    category: "work",
    structure: "right-logical",
    rootText: "会议记录",
    children: [
      { text: "会议信息", children: [{ text: "时间与地点" }, { text: "参会人" }] },
      { text: "主要议题", children: [{ text: "议题一" }, { text: "议题二" }] },
      { text: "讨论决议", children: [{ text: "决议一" }, { text: "决议二" }] },
      { text: "待办事项", children: [{ text: "任务 & 责任人" }] }
    ]
  },
  {
    id: "project-planning",
    name: "项目规划",
    category: "work",
    structure: "right-logical",
    rootText: "项目规划",
    children: [
      { text: "项目背景", children: [{ text: "目标与使命" }] },
      { text: "时间节点", children: [{ text: "第一阶段 (里程碑 1)" }, { text: "第二阶段 (里程碑 2)" }] },
      { text: "成员分工", children: [{ text: "产品/设计" }, { text: "研发/测试" }] },
      { text: "风险应对", children: [{ text: "潜在技术风险" }] }
    ]
  },
  {
    id: "four-quadrants",
    name: "四象限时间工作法",
    category: "work",
    structure: "mindmap",
    rootText: "日常工作时间管理",
    children: [
      { text: "重要且紧急 (第一象限)", children: [{ text: "核心任务" }] },
      { text: "重要但不紧急 (第二象限)", children: [{ text: "长期规划 / 自我提升" }] },
      { text: "紧急但不重要 (第三象限)", children: [{ text: "临时会议 / 杂务" }] },
      { text: "不紧急且不重要 (第四象限)", children: [{ text: "消遣娱乐" }] }
    ]
  },
  {
    id: "swot",
    name: "SWOT分析",
    category: "analysis",
    structure: "mindmap",
    rootText: "SWOT 竞争力分析",
    children: [
      { text: "优势 (Strength)", children: [{ text: "技术积累" }, { text: "团队执行力" }] },
      { text: "劣势 (Weakness)", children: [{ text: "资金限制" }, { text: "市场占有率较低" }] },
      { text: "机会 (Opportunity)", children: [{ text: "行业数字化转型" }] },
      { text: "威胁 (Threat)", children: [{ text: "竞品快速跟进" }] }
    ]
  },
  {
    id: "mckinsey-6w3h",
    name: "麦肯锡6W3H分析法",
    category: "analysis",
    structure: "right-logical",
    rootText: "6W3H 分析框架",
    children: [
      { text: "Who (谁来进行/谁是受众)" },
      { text: "What (做什么事/提供什么)" },
      { text: "Where (在哪里做/应用场景)" },
      { text: "When (什么时间/时机)" },
      { text: "Why (为什么要做/根本原因)" },
      { text: "How (如何实施/具体路径)" },
      { text: "How much (预算与成本)" }
    ]
  },
  {
    id: "six-thinking-hats",
    name: "六项思考帽",
    category: "analysis",
    structure: "mindmap",
    rootText: "六项思考帽决策",
    children: [
      { text: "白帽 (客观事实与数据)" },
      { text: "红帽 (直觉与情感反应)" },
      { text: "黑帽 (谨慎、防范与风险)" },
      { text: "黄帽 (乐观、价值与利益)" },
      { text: "绿帽 (创新与新思路)" },
      { text: "蓝帽 (控制与思维整理)" }
    ]
  },
  {
    id: "novel-outline",
    name: "小说大纲",
    category: "creation",
    structure: "right-logical",
    rootText: "新小说大纲",
    children: [
      { text: "世界观/背景设定" },
      { text: "核心人物", children: [{ text: "男主角" }, { text: "女主角" }] },
      { text: "主线剧情", children: [{ text: "起 (引入/冲突)" }, { text: "承 (发展/铺垫)" }, { text: "转 (高潮/反转)" }, { text: "合 (结局/尾声)" }] },
      { text: "核心矛盾与伏笔" }
    ]
  },
  {
    id: "reading-notes",
    name: "读书笔记",
    category: "creation",
    structure: "right-logical",
    rootText: "《书名》读书笔记",
    children: [
      { text: "基本信息", children: [{ text: "作者 / 出版社" }] },
      { text: "核心观点", children: [{ text: "核心概念 1" }, { text: "核心概念 2" }] },
      { text: "精彩片段 & 摘录" },
      { text: "个人感悟 & 实践方案" }
    ]
  },
  {
    id: "shopping-list",
    name: "购物清单",
    category: "life",
    structure: "mindmap",
    rootText: "购物超市清单",
    children: [
      { text: "生鲜水果", children: [{ text: "苹果/香蕉" }, { text: "牛肉" }] },
      { text: "日用百货", children: [{ text: "纸巾" }, { text: "洗洁精" }] },
      { text: "零食饮料", children: [{ text: "坚果" }, { text: "无糖可乐" }] }
    ]
  },
  {
    id: "travel-plan",
    name: "旅行计划",
    category: "life",
    structure: "mindmap",
    rootText: "出行目的地计划",
    children: [
      { text: "行前准备", children: [{ text: "证件与现金" }, { text: "衣物与常用药" }] },
      { text: "日程安排", children: [{ text: "Day 1: 抵达 & 景点 A" }, { text: "Day 2: 景点 B & 美食" }] },
      { text: "住宿交通", children: [{ text: "机票/高铁票" }, { text: "酒店预订" }] }
    ]
  },
  {
    id: "daily-study-plan",
    name: "每日学习计划",
    category: "education",
    structure: "right-logical",
    rootText: "每日学习计划",
    children: [
      { text: "上午 (08:30 - 11:30)", children: [{ text: "深度阅读 & 理论学习" }] },
      { text: "下午 (14:00 - 17:30)", children: [{ text: "实战练习 / 刷题" }] },
      { text: "晚上 (19:30 - 21:30)", children: [{ text: "错题总结 / 归纳复习" }] }
    ]
  }
];

/* ===== 模板与结构库弹窗 ===== */
interface GalleryModalProps {
  onClose: () => void;
  onCreate: (templateId: string, structure: string, isBlank: boolean) => void;
  t: (key: string) => string;
}

function MindMapGalleryModal({ onClose, onCreate, t }: GalleryModalProps) {
  const [activeCategory, setActiveCategory] = useState<string>("structures");

  const categories = [
    { id: "structures", name: "基础结构" },
    { id: "work", name: "工作管理" },
    { id: "education", name: "教育学习" },
    { id: "analysis", name: "分析汇报" },
    { id: "creation", name: "知识创作" },
    { id: "life", name: "生活娱乐" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-app-surface border border-app-border rounded-xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-app-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="text-accent-primary" size={20} />
            <h3 className="text-base font-bold text-tx-primary">新建思维导图与模板</h3>
          </div>
          <button
            onClick={onClose}
            className="text-tx-tertiary hover:text-tx-primary transition-colors text-sm font-medium"
          >
            取消
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-[180px] border-r border-app-border bg-app-bg/50 p-2 space-y-1 overflow-y-auto">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  activeCategory === cat.id
                    ? "bg-accent-primary text-white"
                    : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Grid Panel */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeCategory === "structures" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {BLANK_STRUCTURES.map((str) => (
                  <button
                    key={str.id}
                    onClick={() => onCreate("", str.id, true)}
                    className="flex flex-col items-center justify-center p-4 rounded-xl border border-app-border bg-app-elevated hover:border-accent-primary hover:shadow-lg transition-all text-center group"
                  >
                    <div className="w-12 h-12 rounded-lg bg-accent-primary/10 flex items-center justify-center text-accent-primary mb-3 group-hover:scale-105 transition-transform">
                      <BrainCircuit size={24} />
                    </div>
                    <span className="text-xs font-bold text-tx-primary">{str.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {PRESET_TEMPLATES.filter((t) => t.category === activeCategory).map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => onCreate(tmpl.id, tmpl.structure, false)}
                    className="flex flex-col text-left p-4 rounded-xl border border-app-border bg-app-elevated hover:border-accent-primary hover:shadow-lg transition-all group"
                  >
                    <div className="w-full aspect-[4/3] rounded-lg bg-app-bg border border-app-border/40 flex flex-col p-3 mb-3 relative overflow-hidden group-hover:scale-[1.01] transition-transform">
                      {/* Structure preview tag */}
                      <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-tx-secondary font-semibold uppercase">
                        {tmpl.structure === "mindmap" ? "导图" : "逻辑图"}
                      </span>
                      {/* Mini visual tree preview */}
                      <div className="flex-1 flex flex-col justify-center space-y-1">
                        <div className="w-16 h-4 rounded bg-accent-primary/20 border border-accent-primary/30 flex items-center px-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                        </div>
                        <div className="flex gap-2 pl-4">
                          <div className="w-12 h-3 rounded bg-zinc-200 dark:bg-zinc-700" />
                          <div className="w-12 h-3 rounded bg-zinc-200 dark:bg-zinc-700" />
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-tx-primary truncate">{tmpl.name}</span>
                    <span className="text-[10px] text-tx-tertiary mt-0.5">点击以应用该模板</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== 主组件 ===== */
export default function MindMapCenter() {
  const { t } = useTranslation();

  // 移动端检测
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [maps, setMaps] = useState<MindMapListItem[]>([]);
  const [activeMap, setActiveMap] = useState<MindMap | null>(null);
  const [mapData, setMapData] = useState<MindMapData | null>(null);
  const [showGalleryModal, setShowGalleryModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载列表
  const loadMaps = useCallback(async () => {
    try {
      const data = await api.getMindMaps();
      setMaps(data);
    } catch (err) {
      console.error("Failed to load mindmaps:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  // 工作区切换：清空当前打开的导图 + 重拉列表，避免显示其他 scope 的图
  useEffect(() => {
    const onWs = () => {
      setActiveMap(null);
      setMapData(null);
      setSelectedNodeId(null);
      setEditingNodeId(null);
      loadMaps();
    };
    window.addEventListener("super:workspace-changed", onWs);
    return () => window.removeEventListener("super:workspace-changed", onWs);
  }, [loadMaps]);

  // 选择一个导图
  const handleSelect = useCallback(async (id: string) => {
    try {
      const map = await api.getMindMap(id);
      setActiveMap(map);
      try {
        const parsed = JSON.parse(map.data);
        setMapData(parsed);
      } catch {
        setMapData({ root: { id: "root", text: map.title, children: [] } });
      }
      setSelectedNodeId(null);
      setEditingNodeId(null);
      setZoom(1);
      setPan({ x: 60, y: 0 });
    } catch (err) {
      console.error("Failed to load mindmap:", err);
    }
  }, []);

  // 自动保存
  const triggerSave = useCallback((data: MindMapData, title?: string) => {
    if (!activeMap) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        const payload: { data: string; title?: string } = { data: JSON.stringify(data) };
        if (title !== undefined) payload.title = title;
        const updated = await api.updateMindMap(activeMap.id, payload);
        setActiveMap(updated);
        setMaps((prev) =>
          prev.map((m) => (m.id === updated.id ? { ...m, title: updated.title, updatedAt: updated.updatedAt } : m))
        );
      } catch (err) {
        console.error("Failed to save mindmap:", err);
      } finally {
        setIsSaving(false);
      }
    }, 600);
  }, [activeMap]);

  // 更新节点树（递归辅助函数）
  const updateNode = useCallback(
    (root: MindMapNode, nodeId: string, updater: (n: MindMapNode) => MindMapNode): MindMapNode => {
      if (root.id === nodeId) return updater(root);
      return {
        ...root,
        children: root.children.map((c) => updateNode(c, nodeId, updater)),
      };
    }, []
  );

  const findNode = useCallback(
    (root: MindMapNode, nodeId: string): MindMapNode | null => {
      if (root.id === nodeId) return root;
      for (const c of root.children) {
        const found = findNode(c, nodeId);
        if (found) return found;
      }
      return null;
    }, []
  );

  const removeNode = useCallback(
    (root: MindMapNode, nodeId: string): MindMapNode => {
      return {
        ...root,
        children: root.children
          .filter((c) => c.id !== nodeId)
          .map((c) => removeNode(c, nodeId)),
      };
    }, []
  );

  // 操作：添加子节点
  const handleAddChild = useCallback((parentId: string) => {
    if (!mapData) return;
    const newId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newNode: MindMapNode = { id: newId, text: t("mindMap.newNode"), children: [] };
    const newRoot = updateNode(mapData.root, parentId, (n) => ({
      ...n,
      collapsed: false,
      children: [...n.children, newNode],
    }));
    const newData = { root: newRoot };
    setMapData(newData);
    setSelectedNodeId(newId);
    setEditingNodeId(newId);
    setEditValue(newNode.text);
    triggerSave(newData);
  }, [mapData, updateNode, triggerSave, t]);

  // 操作：删除节点
  const handleDeleteNode = useCallback((nodeId: string) => {
    if (!mapData || nodeId === "root") return;
    const newRoot = removeNode(mapData.root, nodeId);
    const newData = { root: newRoot };
    setMapData(newData);
    setSelectedNodeId(null);
    triggerSave(newData);
  }, [mapData, removeNode, triggerSave]);

  // 操作：编辑提交
  const handleEditSubmit = useCallback(() => {
    if (!mapData || !editingNodeId) return;
    const trimmed = editValue.trim() || t("mindMap.newNode");
    const newRoot = updateNode(mapData.root, editingNodeId, (n) => ({ ...n, text: trimmed }));
    const newData = { root: newRoot };
    setMapData(newData);
    setEditingNodeId(null);
    // 如果编辑的是根节点，同步更新标题
    const isRoot = editingNodeId === "root";
    triggerSave(newData, isRoot ? trimmed : undefined);
    if (isRoot) {
      setMaps((prev) =>
        prev.map((m) => (m.id === activeMap?.id ? { ...m, title: trimmed } : m))
      );
    }
  }, [mapData, editingNodeId, editValue, updateNode, triggerSave, activeMap, t]);

  // 操作：折叠/展开
  const handleToggleCollapse = useCallback((nodeId: string) => {
    if (!mapData) return;
    const newRoot = updateNode(mapData.root, nodeId, (n) => ({
      ...n,
      collapsed: !n.collapsed,
    }));
    const newData = { root: newRoot };
    setMapData(newData);
    triggerSave(newData);
  }, [mapData, updateNode, triggerSave]);

  // 创建新导图 (打开模板与结构库)
  const handleCreate = useCallback(() => {
    setShowGalleryModal(true);
  }, []);

  // 从选定的结构或模板创建
  const handleCreateFromTemplate = useCallback(async (templateId: string, structure: string, isBlank: boolean = false) => {
    try {
      let rootNode: MindMapNode = {
        id: "root",
        text: "中心主题",
        children: []
      };

      let title = t("mindMap.untitled");

      if (isBlank) {
        const match = BLANK_STRUCTURES.find(s => s.id === structure);
        title = match ? match.name : t("mindMap.untitled");
        rootNode.text = title;
      } else {
        const template = PRESET_TEMPLATES.find(t => t.id === templateId);
        if (template) {
          title = template.name;
          rootNode.text = template.rootText;
          const buildPresetNodes = (pNode: { text: string; children?: any[] }): MindMapNode => {
            const newId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            return {
              id: newId,
              text: pNode.text,
              children: pNode.children ? pNode.children.map(buildPresetNodes) : []
            };
          };
          rootNode.children = template.children ? template.children.map(buildPresetNodes) : [];
        }
      }

      const map = await api.createMindMap({
        title,
        data: JSON.stringify({
          root: rootNode,
          structure: structure
        })
      });

      setMaps((prev) => [
        { id: map.id, userId: map.userId, workspaceId: map.workspaceId, title: map.title, createdAt: map.createdAt, updatedAt: map.updatedAt },
        ...prev
      ]);
      handleSelect(map.id);
      setShowGalleryModal(false);
    } catch (err) {
      console.error("Failed to create mindmap from template:", err);
    }
  }, [handleSelect, t]);

  // 删除导图
  const handleDeleteMap = useCallback(async (id: string) => {
    try {
      await api.deleteMindMap(id);
      setMaps((prev) => prev.filter((m) => m.id !== id));
      if (activeMap?.id === id) {
        setActiveMap(null);
        setMapData(null);
      }
    } catch (err) {
      console.error("Failed to delete mindmap:", err);
    }
  }, [activeMap]);

  // 切换可见性
  const handleVisibilityChange = useCallback(async (visibility: "PRIVATE" | "WORKSPACE") => {
    if (!activeMap) return;
    try {
      const updated = await api.updateMindMap(activeMap.id, { visibility } as any);
      setActiveMap(updated);
      setMaps((prev) =>
        prev.map((m) => (m.id === updated.id ? { ...m, visibility: updated.visibility } : m))
      );
    } catch (err) {
      console.error("Failed to toggle mindmap visibility:", err);
    }
  }, [activeMap]);

  // 缩放
  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.15, 2.5));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.3));
  const handleZoomReset = () => { setZoom(1); setPan({ x: 60, y: 0 }); };

  // 平移（鼠标）
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.target === svgRef.current)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z) => Math.max(0.3, Math.min(2.5, z + delta)));
    } else {
      setPan((p) => ({ x: p.x - e.deltaX * 0.5, y: p.y - e.deltaY * 0.5 }));
    }
  }, []);

  // 触摸手势（移动端）
  const touchRef = useRef<{ startX: number; startY: number; panX: number; panY: number; dist: number; zoom: number; isTap: boolean; tapTimer: ReturnType<typeof setTimeout> | null }>({
    startX: 0, startY: 0, panX: 0, panY: 0, dist: 0, zoom: 1, isTap: true, tapTimer: null,
  });

  const getTouchDist = (t1: React.Touch, t2: React.Touch) =>
    Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = touchRef.current;
    if (e.touches.length === 1) {
      t.startX = e.touches[0].clientX;
      t.startY = e.touches[0].clientY;
      t.panX = pan.x;
      t.panY = pan.y;
      t.isTap = true;
    } else if (e.touches.length === 2) {
      e.preventDefault();
      t.dist = getTouchDist(e.touches[0], e.touches[1]);
      t.zoom = zoom;
      t.isTap = false;
    }
  }, [pan, zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const t = touchRef.current;
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - t.startX;
      const dy = e.touches[0].clientY - t.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) t.isTap = false;
      setPan({ x: t.panX + dx, y: t.panY + dy });
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const newDist = getTouchDist(e.touches[0], e.touches[1]);
      const scale = newDist / t.dist;
      setZoom(Math.max(0.3, Math.min(2.5, t.zoom * scale)));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    // tap 由 onClick 处理
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!mapData || !selectedNodeId || editingNodeId) return;

      if (e.key === "Tab") {
        e.preventDefault();
        handleAddChild(selectedNodeId);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeId !== "root") {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        }
      } else if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        const node = findNode(mapData.root, selectedNodeId);
        if (node) {
          setEditingNodeId(selectedNodeId);
          setEditValue(node.text);
        }
      } else if (e.key === " ") {
        e.preventDefault();
        handleToggleCollapse(selectedNodeId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mapData, selectedNodeId, editingNodeId, handleAddChild, handleDeleteNode, handleToggleCollapse, findNode]);

  // 构建布局
  const { layoutNodes, edges, viewBox, bounds } = useMemo(() => {
    if (!mapData) return { layoutNodes: [], edges: [], viewBox: "0 0 800 600", bounds: { minX: 0, minY: 0, width: 800, height: 600 } };

    const root = buildLayout(mapData.root, 0, null);
    const structure = mapData.structure || "right-logical";
    applyLayout(root, structure);
    const all = flattenNodes(root);

    const edgeList: { from: LayoutNode; to: LayoutNode }[] = [];
    const collectEdges = (n: LayoutNode) => {
      n.children.forEach((c) => {
        edgeList.push({ from: n, to: c });
        collectEdges(c);
      });
    };
    collectEdges(root);

    // 计算 viewBox 边界
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height + 36);
    });
    const pad = 80;
    const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
    const bounds = { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };

    return { layoutNodes: all, edges: edgeList, viewBox: vb, bounds };
  }, [mapData]);

  const [showMiniMap, setShowMiniMap] = useState(!isMobile);

  // 列表右键菜单
  const [listContextMenu, setListContextMenu] = useState<{ x: number; y: number; mapId: string; title: string } | null>(null);

  const handleListContextMenu = useCallback((e: React.MouseEvent, item: MindMapListItem) => {
    e.preventDefault();
    e.stopPropagation();
    setListContextMenu({ x: e.clientX, y: e.clientY, mapId: item.id, title: item.title });
  }, []);

  // 点击其他地方关闭列表右键菜单
  useEffect(() => {
    if (!listContextMenu) return;
    const close = () => setListContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("contextmenu", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("contextmenu", close, true);
    };
  }, [listContextMenu]);

  // 根据 MindMapData 生成布局并构建导出用的干净 SVG 字符串
  const buildExportSvgFromData = useCallback((data: MindMapData) => {
    const root = buildLayout(data.root, 0, null);
    const structure = data.structure || "right-logical";
    applyLayout(root, structure);
    const allNodes = flattenNodes(root);

    const edgeList: { from: LayoutNode; to: LayoutNode }[] = [];
    const collectEdges = (n: LayoutNode) => {
      n.children.forEach((c) => {
        edgeList.push({ from: n, to: c });
        collectEdges(c);
      });
    };
    collectEdges(root);

    if (allNodes.length === 0) return null;

    const pad = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allNodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    });
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${minX - pad} ${minY - pad} ${w} ${h}" style="background:#fff">\n`;

    edgeList.forEach((e) => {
      const p = getEdgePath(e.from, e.to, structure);
      svgContent += `  <path d="${p}" fill="none" stroke="rgb(203,213,225)" stroke-width="2"/>\n`;
    });

    allNodes.forEach((n) => {
      const color = getNodeColor(n.depth);
      const isRoot = n.depth === 0;
      const fontSize = isRoot ? 14 : 13;
      const fontWeight = isRoot ? 700 : 500;
      const resolvedBg = resolveCssColor(color.bg);
      const resolvedBorder = resolveCssColor(color.border);
      const resolvedText = resolveCssColor(color.text);
      svgContent += `  <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${resolvedBg}" stroke="${resolvedBorder}" stroke-width="1.5"/>\n`;
      svgContent += `  <text x="${n.x + 12}" y="${n.y + n.height / 2}" dominant-baseline="central" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${resolvedText}">${escapeXml(n.text)}</text>\n`;
    });

    svgContent += `</svg>`;
    return { svgContent, width: w, height: h };
  }, []);

  // 加载指定导图数据
  const loadMapData = useCallback(async (mapId: string): Promise<{ data: MindMapData; title: string } | null> => {
    try {
      const map = await api.getMindMap(mapId);
      const parsed = JSON.parse(map.data) as MindMapData;
      return { data: parsed, title: map.title };
    } catch {
      return null;
    }
  }, []);

  const handleListDownloadSVG = useCallback(async () => {
    if (!listContextMenu) return;
    const { mapId, title } = listContextMenu;
    setListContextMenu(null);
    const result = await loadMapData(mapId);
    if (!result) return;
    const svgResult = buildExportSvgFromData(result.data);
    if (!svgResult) return;
    const blob = new Blob([svgResult.svgContent], { type: "image/svg+xml;charset=utf-8" });
    await downloadBlob(blob, `${title || "mindmap"}.svg`);
  }, [listContextMenu, loadMapData, buildExportSvgFromData]);

  const handleListDownloadPNG = useCallback(async () => {
    if (!listContextMenu) return;
    const { mapId, title } = listContextMenu;
    setListContextMenu(null);
    const result = await loadMapData(mapId);
    if (!result) return;
    const svgResult = buildExportSvgFromData(result.data);
    if (!svgResult) return;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = svgResult.width * scale;
    canvas.height = svgResult.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new window.Image();
    const svgBlob = new Blob([svgResult.svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await downloadBlob(blob, `${title || "mindmap"}.png`);
      }, "image/png");
    };
    img.src = url;
  }, [listContextMenu, loadMapData, buildExportSvgFromData]);

  // 将 MindMapNode 转换为 xmind 的 content.json 格式
  const buildXmindContent = useCallback((data: MindMapData, title: string) => {
    const convertNode = (node: MindMapNode): Record<string, unknown> => {
      const result: Record<string, unknown> = {
        id: node.id,
        title: node.text,
      };
      if (node.children && node.children.length > 0) {
        result.children = {
          attached: node.children.map(convertNode),
        };
      }
      return result;
    };

    return [
      {
        id: "sheet-1",
        title: title,
        rootTopic: convertNode(data.root),
      },
    ];
  }, []);

  const handleListDownloadXmind = useCallback(async () => {
    if (!listContextMenu) return;
    const { mapId, title } = listContextMenu;
    setListContextMenu(null);
    const result = await loadMapData(mapId);
    if (!result) return;

    const content = buildXmindContent(result.data, title);
    const contentJson = JSON.stringify(content);
    const metadata = JSON.stringify({ creator: { name: "super-note", version: "1.0.0" } });
    const manifest = JSON.stringify({ "file-entries": { "content.json": {}, "metadata.json": {} } });

    // 使用简易 ZIP 打包（无压缩），xmind 本质是 ZIP
    const encoder = new TextEncoder();
    const files: { name: string; data: Uint8Array }[] = [
      { name: "content.json", data: encoder.encode(contentJson) },
      { name: "metadata.json", data: encoder.encode(metadata) },
      { name: "manifest.json", data: encoder.encode(manifest) },
    ];

    // 构建 ZIP 格式
    const parts: Uint8Array[] = [];
    const centralDir: Uint8Array[] = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      // Local file header
      const header = new ArrayBuffer(30 + nameBytes.length);
      const hView = new DataView(header);
      hView.setUint32(0, 0x04034b50, true); // signature
      hView.setUint16(4, 20, true); // version needed
      hView.setUint16(6, 0, true); // flags
      hView.setUint16(8, 0, true); // compression (store)
      hView.setUint16(10, 0, true); // mod time
      hView.setUint16(12, 0, true); // mod date
      // CRC-32
      const crc = crc32(file.data);
      hView.setUint32(14, crc, true);
      hView.setUint32(18, file.data.length, true); // compressed size
      hView.setUint32(22, file.data.length, true); // uncompressed size
      hView.setUint16(26, nameBytes.length, true); // name length
      hView.setUint16(28, 0, true); // extra length
      new Uint8Array(header).set(nameBytes, 30);

      const headerBytes = new Uint8Array(header);
      parts.push(headerBytes);
      parts.push(file.data);

      // Central directory entry
      const cde = new ArrayBuffer(46 + nameBytes.length);
      const cView = new DataView(cde);
      cView.setUint32(0, 0x02014b50, true); // signature
      cView.setUint16(4, 20, true); // version made by
      cView.setUint16(6, 20, true); // version needed
      cView.setUint16(8, 0, true); // flags
      cView.setUint16(10, 0, true); // compression
      cView.setUint16(12, 0, true); // mod time
      cView.setUint16(14, 0, true); // mod date
      cView.setUint32(16, crc, true);
      cView.setUint32(20, file.data.length, true);
      cView.setUint32(24, file.data.length, true);
      cView.setUint16(28, nameBytes.length, true);
      cView.setUint16(30, 0, true); // extra length
      cView.setUint16(32, 0, true); // comment length
      cView.setUint16(34, 0, true); // disk number
      cView.setUint16(36, 0, true); // internal attrs
      cView.setUint32(38, 0, true); // external attrs
      cView.setUint32(42, offset, true); // local header offset
      new Uint8Array(cde).set(nameBytes, 46);
      centralDir.push(new Uint8Array(cde));

      offset += headerBytes.length + file.data.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    centralDir.forEach((cd) => { parts.push(cd); centralDirSize += cd.length; });

    // End of central directory
    const eocd = new ArrayBuffer(22);
    const eView = new DataView(eocd);
    eView.setUint32(0, 0x06054b50, true);
    eView.setUint16(4, 0, true);
    eView.setUint16(6, 0, true);
    eView.setUint16(8, files.length, true);
    eView.setUint16(10, files.length, true);
    eView.setUint32(12, centralDirSize, true);
    eView.setUint32(16, centralDirOffset, true);
    eView.setUint16(20, 0, true);
    parts.push(new Uint8Array(eocd));

    const totalLen = parts.reduce((s, p) => s + p.length, 0);
    const zipData = new Uint8Array(totalLen);
    let pos = 0;
    parts.forEach((p) => { zipData.set(p, pos); pos += p.length; });

    const blob = new Blob([zipData], { type: "application/octet-stream" });
    await downloadBlob(blob, `${title || "mindmap"}.xmind`);
  }, [listContextMenu, loadMapData, buildXmindContent]);

  // 自动居中
  useEffect(() => {
    if (mapData && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPan({ x: 60, y: rect.height / 2 - 40 });
    }
  }, [activeMap?.id]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* 移动端遮罩层 */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left: Map List Panel */}
      <div
        className={cn(
          "border-r border-app-border bg-app-surface flex flex-col transition-all duration-200",
          isMobile
            ? "fixed inset-y-0 left-0 z-40 w-[280px] shadow-2xl"
            : "w-[260px] min-w-[260px] shrink-0",
          isMobile && !sidebarOpen && "-translate-x-full"
        )}
      >
        <div className="px-4 py-4 border-b border-app-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BrainCircuit size={18} className="text-accent-primary" />
              <h2 className="text-sm font-bold text-tx-primary">{t("mindMap.title")}</h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCreate}
                className="p-1.5 rounded-md hover:bg-app-hover transition-colors text-tx-secondary hover:text-accent-primary"
                title={t("mindMap.create")}
              >
                <Plus size={16} />
              </button>
              {isMobile && (
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-1.5 rounded-md hover:bg-app-hover transition-colors text-tx-secondary"
                >
                  <PanelLeftClose size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="mt-1 text-xs text-tx-tertiary">
            {t("mindMap.totalCount", { count: maps.length })}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-20 text-tx-tertiary text-sm">
              {t("common.loading")}
            </div>
          ) : maps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-tx-tertiary">
              <BrainCircuit size={32} className="mb-2 opacity-30" />
              <span className="text-xs">{t("mindMap.empty")}</span>
              <button
                onClick={handleCreate}
                className="mt-3 text-xs text-accent-primary hover:opacity-90 font-medium"
              >
                {t("mindMap.createFirst")}
              </button>
            </div>
          ) : (
            maps.map((m) => (
              <MindMapListRow
                key={m.id}
                item={m}
                isActive={activeMap?.id === m.id}
                onSelect={() => { handleSelect(m.id); if (isMobile) setSidebarOpen(false); }}
                onDelete={() => handleDeleteMap(m.id)}
                onContextMenu={(e) => handleListContextMenu(e, m)}
              />
            ))
          )}
        </div>
      </div>

      {/* Center: Mind Map Canvas */}
      <div className="flex-1 flex flex-col overflow-hidden bg-app-bg transition-colors" ref={containerRef}>
        {activeMap && mapData ? (
          <>
            {/* Toolbar */}
            <div className="px-2 sm:px-4 py-2 border-b border-app-border flex items-center justify-between bg-app-surface/50 gap-1">
              <div className="flex items-center gap-2 min-w-0">
                {isMobile && (
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="p-1.5 rounded-md hover:bg-app-hover text-tx-secondary transition-colors flex-shrink-0"
                  >
                    <Menu size={16} />
                  </button>
                )}
                <h1 className="text-sm font-semibold text-tx-primary truncate max-w-[120px] sm:max-w-[300px]">
                  {activeMap.title}
                </h1>
                {isSaving ? (
                  <span className="flex items-center gap-1 text-xs text-tx-tertiary flex-shrink-0">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="hidden sm:inline">{t("mindMap.saving")}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-green-500 flex-shrink-0">
                    <Check size={12} />
                    <span className="hidden sm:inline">{t("mindMap.saved")}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <VisibilityToggle
                  value={activeMap.visibility || "PRIVATE"}
                  onChange={handleVisibilityChange}
                  size="sm"
                />
                <div className="w-px h-4 bg-app-border mx-0.5" />
                <button
                  onClick={handleZoomOut}
                  className="p-1.5 rounded-md hover:bg-app-hover text-tx-secondary transition-colors"
                  title={t("mindMap.zoomOut")}
                >
                  <ZoomOut size={16} />
                </button>
                <span className="text-xs text-tx-tertiary w-12 text-center tabular-nums hidden sm:inline-block">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="p-1.5 rounded-md hover:bg-app-hover text-tx-secondary transition-colors"
                  title={t("mindMap.zoomIn")}
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  onClick={handleZoomReset}
                  className="p-1.5 rounded-md hover:bg-app-hover text-tx-secondary transition-colors"
                  title={t("mindMap.fitView")}
                >
                  <Maximize2 size={16} />
                </button>
                <div className="w-px h-4 bg-app-border mx-0.5" />
                
                {/* 结构选择下拉菜单 */}
                <select
                  value={mapData.structure || "right-logical"}
                  onChange={(e) => {
                    const newStructure = e.target.value;
                    const newData = { ...mapData, structure: newStructure };
                    setMapData(newData);
                    triggerSave(newData);
                  }}
                  className="px-2 py-1 text-xs rounded border border-app-border bg-app-surface text-tx-primary outline-none focus:border-accent-primary"
                >
                  <option value="right-logical">向右逻辑图</option>
                  <option value="left-logical">向左逻辑图</option>
                  <option value="mindmap">思维导图</option>
                  <option value="org-chart">组织结构图</option>
                  <option value="down-classification">向下分类图</option>
                  <option value="up-classification">向上分类图</option>
                  <option value="fishbone">鱼骨图</option>
                  <option value="h-timeline">横向时间轴</option>
                  <option value="v-timeline">竖向时间轴</option>
                  <option value="circle-map">圆圈图</option>
                  <option value="bubble-map">气泡图</option>
                  <option value="double-bubble">双气泡图</option>
                  <option value="brace-map">括号图</option>
                  <option value="left-brace-map">向左括号图</option>
                  <option value="flowchart">基础流程图</option>
                  <option value="multi-flowchart">复流程图</option>
                  <option value="bridge-map">桥形图</option>
                  <option value="outline">大纲模式</option>
                </select>

                <div className="w-px h-4 bg-app-border mx-0.5" />
                <button
                  onClick={() => setShowMiniMap((v) => !v)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    showMiniMap
                      ? "bg-accent-primary/10 dark:bg-accent-primary/20 text-accent-primary"
                      : "hover:bg-app-hover text-tx-secondary"
                  )}
                  title={t("mindMap.miniMap")}
                >
                  <Map size={16} />
                </button>
              </div>
            </div>

            {/* 画布 / 大纲编辑器 */}
            {mapData.structure === "outline" ? (
              <div className="flex-1 overflow-auto p-6 bg-app-surface/50 border-t border-app-border">
                <div className="max-w-3xl mx-auto space-y-4">
                  <div className="text-xl font-bold text-tx-primary border-b border-app-border pb-2 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent-primary shrink-0" />
                    <input
                      value={mapData.root.text}
                      onChange={(e) => {
                        const trimmed = e.target.value;
                        const newRoot = { ...mapData.root, text: trimmed };
                        const newData = { ...mapData, root: newRoot };
                        setMapData(newData);
                        triggerSave(newData, trimmed);
                      }}
                      className="flex-1 bg-transparent outline-none font-bold"
                      placeholder="中心主题"
                    />
                  </div>
                  <div className="space-y-1">
                    {mapData.root.children.map((c) => (
                      <OutlineNodeItem
                        key={c.id}
                        node={c}
                        depth={0}
                        onUpdateText={(id, text) => {
                          const newRoot = updateNode(mapData.root, id, (n) => ({ ...n, text }));
                          const newData = { ...mapData, root: newRoot };
                          setMapData(newData);
                          triggerSave(newData);
                        }}
                        onAddSibling={(id) => {
                          const newRoot = addOutlineSibling(mapData.root, id);
                          const newData = { ...mapData, root: newRoot };
                          setMapData(newData);
                          triggerSave(newData);
                        }}
                        onIndent={(id) => {
                          const newRoot = indentOutlineNode(mapData.root, id);
                          const newData = { ...mapData, root: newRoot };
                          setMapData(newData);
                          triggerSave(newData);
                        }}
                        onOutdent={(id) => {
                          const res = outdentOutlineNode(mapData.root, id);
                          if (res.success) {
                            const newData = { ...mapData, root: res.root };
                            setMapData(newData);
                            triggerSave(newData);
                          }
                        }}
                        onDelete={(id) => {
                          const newRoot = removeNode(mapData.root, id);
                          const newData = { ...mapData, root: newRoot };
                          setMapData(newData);
                          triggerSave(newData);
                        }}
                      />
                    ))}
                    {mapData.root.children.length === 0 && (
                      <button
                        onClick={() => {
                          const newRoot = addOutlineSibling(mapData.root, "root");
                          const newData = { ...mapData, root: newRoot };
                          setMapData(newData);
                          triggerSave(newData);
                        }}
                        className="text-xs text-accent-primary hover:opacity-90 font-medium py-2"
                      >
                        + 添加分支主题
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing relative"
                style={{ userSelect: "none" }}
              >
                <svg
                  ref={svgRef}
                  width="100%"
                  height="100%"
                  viewBox={viewBox}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onClick={() => { setSelectedNodeId(null); setEditingNodeId(null); }}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "0 0",
                    touchAction: "none",
                  }}
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="6"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 2 L 8 5 L 0 8 z" fill="rgb(156,163,175)" />
                    </marker>
                  </defs>

                  {/* Edges */}
                  {edges.map((e, i) => (
                    <Edge key={`${e.from.id}-${e.to.id}-${i}`} from={e.from} to={e.to} structure={mapData.structure || "right-logical"} />
                  ))}

                  {/* Nodes */}
                  {layoutNodes.map((n) => (
                    <NodeBox
                      key={n.id}
                      node={n}
                      isSelected={selectedNodeId === n.id}
                      isEditing={editingNodeId === n.id}
                      editValue={editValue}
                      onSelect={() => setSelectedNodeId(n.id)}
                      onDoubleClick={() => {
                        setEditingNodeId(n.id);
                        setEditValue(n.text);
                      }}
                      onEditChange={setEditValue}
                      onEditSubmit={handleEditSubmit}
                      onToggleCollapse={() => handleToggleCollapse(n.id)}
                      onAddChild={() => handleAddChild(n.id)}
                      onDelete={() => handleDeleteNode(n.id)}
                      isMobile={isMobile}
                      onContextMenu={(e) => e.preventDefault()}
                    />
                  ))}
                </svg>

                {/* MiniMap 小地图 */}
                {showMiniMap && layoutNodes.length > 0 && (
                  <div
                    className="absolute right-2 bottom-2 sm:right-3 sm:bottom-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden"
                    style={{ width: isMobile ? 140 : 180, height: isMobile ? 90 : 120 }}
                  >
                    <svg
                      width="100%"
                      height="100%"
                      viewBox={viewBox}
                      preserveAspectRatio="xMidYMid meet"
                      className="cursor-pointer"
                      onClick={(e) => {
                        const svg = e.currentTarget;
                        const rect = svg.getBoundingClientRect();
                        const svgX = ((e.clientX - rect.left) / rect.width) * bounds.width + bounds.minX;
                        const svgY = ((e.clientY - rect.top) / rect.height) * bounds.height + bounds.minY;
                        if (containerRef.current) {
                          const cr = containerRef.current.getBoundingClientRect();
                          setPan({
                            x: cr.width / 2 - svgX * zoom,
                            y: cr.height / 2 - svgY * zoom,
                          });
                        }
                      }}
                    >
                      {/* 连线 */}
                      {edges.map((e, i) => {
                        const x1 = e.from.x + e.from.width;
                        const y1 = e.from.y + e.from.height / 2;
                        const x2 = e.to.x;
                        const y2 = e.to.y + e.to.height / 2;
                        return (
                          <line
                            key={`mini-e-${i}`}
                            x1={x1} y1={y1} x2={x2} y2={y2}
                            stroke="rgb(203,213,225)"
                            strokeWidth={3}
                            className="dark:stroke-zinc-600"
                          />
                        );
                      })}
                      {/* 节点 */}
                      {layoutNodes.map((n) => {
                        const color = getNodeColor(n.depth);
                        return (
                          <rect
                            key={`mini-n-${n.id}`}
                            x={n.x} y={n.y}
                            width={n.width} height={n.height}
                            rx={4}
                            fill={color.bg}
                            stroke={color.border}
                            strokeWidth={2}
                          />
                        );
                      })}
                      {/* 视口指示框 */}
                      {containerRef.current && (() => {
                        const cr = containerRef.current!.getBoundingClientRect();
                        const vpX = -pan.x / zoom;
                        const vpY = (-pan.y + 40) / zoom;
                        const vpW = cr.width / zoom;
                        const vpH = (cr.height - 80) / zoom;
                        return (
                          <rect
                            x={vpX} y={vpY}
                            width={vpW} height={vpH}
                            fill="rgba(99,102,241,0.08)"
                            stroke="rgb(99,102,241)"
                            strokeWidth={4}
                            rx={3}
                          />
                        );
                      })()}
                    </svg>
                  </div>
                )}
              </div>
            )}
            {!isMobile && (
              <div className="px-4 py-1.5 border-t border-app-border bg-app-surface/30 flex items-center gap-4 text-[11px] text-tx-tertiary">
                {mapData.structure === "outline" ? (
                  <>
                    <span><kbd className="px-1 py-0.5 rounded border border-app-border bg-app-bg text-[10px]">Enter</kbd> 新增同级</span>
                    <span><kbd className="px-1 py-0.5 rounded border border-app-border bg-app-bg text-[10px]">Tab</kbd> 缩进为子级</span>
                    <span><kbd className="px-1 py-0.5 rounded border border-app-border bg-app-bg text-[10px]">Shift+Tab</kbd> 提升为父级</span>
                    <span><kbd className="px-1 py-0.5 rounded border border-app-border bg-app-bg text-[10px]">Backspace</kbd> 删除空节点</span>
                  </>
                ) : (
                  <>
                    <span><kbd className="px-1 py-0.5 rounded border border-app-border bg-app-bg text-[10px]">Tab</kbd> {t("mindMap.shortcutAdd")}</span>
                    <span><kbd className="px-1 py-0.5 rounded border border-app-border bg-app-bg text-[10px]">Enter</kbd> {t("mindMap.shortcutEdit")}</span>
                    <span><kbd className="px-1 py-0.5 rounded border border-app-border bg-app-bg text-[10px]">Del</kbd> {t("mindMap.shortcutDelete")}</span>
                    <span><kbd className="px-1 py-0.5 rounded border border-app-border bg-app-bg text-[10px]">Space</kbd> {t("mindMap.shortcutCollapse")}</span>
                    <span>{t("mindMap.dragToMove")}</span>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-tx-tertiary relative">
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="absolute top-3 left-3 p-2 rounded-md hover:bg-app-hover text-tx-secondary transition-colors"
              >
                <Menu size={20} />
              </button>
            )}
            <BrainCircuit size={48} className="mb-3 opacity-20" />
            <span className="text-sm">{t("mindMap.selectOrCreate")}</span>
            <button
              onClick={handleCreate}
              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white text-sm font-medium hover:opacity-90 transition-colors"
            >
              <Plus size={16} />
              {t("mindMap.create")}
            </button>
          </div>
        )}
      </div>

      {/* 模板与结构库弹窗 */}
      {showGalleryModal && (
        <MindMapGalleryModal
          onClose={() => setShowGalleryModal(false)}
          onCreate={handleCreateFromTemplate}
          t={t}
        />
      )}

      {/* 列表右键菜单 */}
      {listContextMenu && (
        <MindMapContextMenuOverlay
          menu={listContextMenu}
          onClose={() => setListContextMenu(null)}
          onDownloadPNG={handleListDownloadPNG}
          onDownloadSVG={handleListDownloadSVG}
          onDownloadXmind={handleListDownloadXmind}
          t={t}
        />
      )}
    </div>
  );
}

/* ===== 列表右键菜单（带位置修正） ===== */
function MindMapContextMenuOverlay({
  menu,
  onClose,
  onDownloadPNG,
  onDownloadSVG,
  onDownloadXmind,
  t,
}: {
  menu: { x: number; y: number; mapId: string; title: string };
  onClose: () => void;
  onDownloadPNG: () => void;
  onDownloadSVG: () => void;
  onDownloadXmind: () => void;
  t: (key: string) => string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  // 位置边界修正
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let newX = menu.x;
      let newY = menu.y;
      if (newX + rect.width > vw - 8) newX = vw - rect.width - 8;
      if (newY + rect.height > vh - 8) newY = vh - rect.height - 8;
      if (newX < 8) newX = 8;
      if (newY < 8) newY = 8;
      setPos({ x: newX, y: newY });
    });
  }, [menu.x, menu.y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] py-1 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-primary hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        onClick={onDownloadPNG}
      >
        <Image size={15} className="text-accent-primary" />
        {t("mindMap.downloadPNG")}
      </button>
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-primary hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        onClick={onDownloadSVG}
      >
        <FileImage size={15} className="text-emerald-500" />
        {t("mindMap.downloadSVG")}
      </button>
      <div className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-primary hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        onClick={onDownloadXmind}
      >
        <FileDown size={15} className="text-orange-500" />
        {t("mindMap.downloadXmind")}
      </button>
    </div>
  );
}
