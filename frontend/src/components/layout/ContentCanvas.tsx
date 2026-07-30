/**
 * 一级页面内容画布（Page Contract）
 * - 统一滚动容器、安全底边距、可选 max-width
 * - 与 MobileChromeHeader / PageHeader 配合使用
 */
import React from "react";
import { cn } from "@/lib/utils";

export interface ContentCanvasProps {
  children: React.ReactNode;
  className?: string;
  /** 内层内容最大宽度（居中），如 max-w-3xl */
  maxWidthClass?: string;
  /** 是否自身可滚动（默认 true） */
  scrollable?: boolean;
  /** 关闭默认水平 padding */
  flush?: boolean;
  /** 透传 ref 到滚动容器 */
  scrollRef?: React.Ref<HTMLDivElement>;
}

export default function ContentCanvas({
  children,
  className,
  maxWidthClass,
  scrollable = true,
  flush = false,
  scrollRef,
}: ContentCanvasProps) {
  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex-1 min-h-0",
        scrollable && "overflow-y-auto overscroll-contain",
        !flush && "px-4 md:px-6",
        className,
      )}
    >
      {maxWidthClass ? (
        <div className={cn("mx-auto w-full py-4 md:py-6", maxWidthClass)}>
          {children}
        </div>
      ) : (
        <div className={cn(!flush && "py-4 md:py-6")}>{children}</div>
      )}
    </div>
  );
}
