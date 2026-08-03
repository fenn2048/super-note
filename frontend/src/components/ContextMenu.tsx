import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  menuRef: React.RefObject<HTMLDivElement | null>;
  onAction: (actionId: string) => void;
  header?: string;
}

export default function ContextMenu({
  isOpen, x, y, items, menuRef, onAction, header,
}: ContextMenuProps) {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const [adjustedPos, setAdjustedPos] = React.useState({ x, y });

  // 同步内部 ref 到外部 menuRef
  useEffect(() => {
    if (menuRef && "current" in menuRef) {
      (menuRef as React.MutableRefObject<HTMLDivElement | null>).current = internalRef.current;
    }
  });

  // 位置边界修正：防止菜单超出屏幕
  useEffect(() => {
    if (!isOpen) return;
    // 延迟一帧，等 DOM 渲染后获取菜单尺寸
    requestAnimationFrame(() => {
      const el = internalRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let newX = x;
      let newY = y;
      // 右侧溢出
      if (newX + rect.width > vw - 8) {
        newX = vw - rect.width - 8;
      }
      // 底部溢出
      if (newY + rect.height > vh - 8) {
        newY = vh - rect.height - 8;
      }
      // 左侧溢出
      if (newX < 8) newX = 8;
      // 顶部溢出
      if (newY < 8) newY = 8;
      if (newX !== x || newY !== y) {
        setAdjustedPos({ x: newX, y: newY });
      }
    });
  }, [isOpen, x, y]);

  // x/y 变化时重置 adjustedPos
  useEffect(() => {
    setAdjustedPos({ x, y });
  }, [x, y]);

  const [menuOpen, setMenuOpen] = React.useState(false);
  useEffect(() => {
    if (!isOpen) {
      setMenuOpen(false);
      return;
    }
    setMenuOpen(false);
    const id = requestAnimationFrame(() => setMenuOpen(true));
    return () => cancelAnimationFrame(id);
  }, [isOpen, x, y]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={internalRef}
      style={{
        position: "fixed",
        top: adjustedPos.y,
        left: adjustedPos.x,
        transformOrigin: "top left",
      }}
      // 必须用语义色：zinc-* 被映射成 CSS 变量后，dark:bg-zinc-900/95 透明度会失效，
      // 深色模式仍露出 bg-white，菜单整块发白、文字发虚。
      className={cn(
        "z-popover w-48 py-1 select-none rounded-card shadow-lg",
        "bg-app-elevated text-tx-primary",
        "border border-app-border",
        "backdrop-blur-md",
        "origin-top-left transition-[transform,opacity] duration-micro ease-out",
        menuOpen ? "opacity-100 scale-100" : "opacity-0 scale-[0.97]",
      )}
    >
      {header && (
        <div className="px-3 py-1.5 text-[11px] font-medium text-tx-tertiary border-b border-app-border mb-0.5 truncate">
          {header}
        </div>
      )}
      {items.map((item) =>
        item.separator ? (
          <div key={item.id} className="h-px bg-app-border my-1 mx-2" />
        ) : (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!item.disabled) onAction(item.id);
            }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
              item.disabled && "opacity-40 cursor-not-allowed",
              item.danger
                ? "text-accent-danger hover:bg-accent-danger/10"
                : "text-tx-primary hover:bg-app-hover",
            )}
          >
            {item.icon && (
              <span className="w-4 h-4 flex items-center justify-center text-tx-secondary">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}

