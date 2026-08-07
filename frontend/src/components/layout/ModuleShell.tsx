/**
 * 一级模块壳：移动 Chrome + 桌面 PageHeader + ContentCanvas
 * 记账 / 健康等 Tier-2 模块共用，避免顶栏与返回心智分裂。
 */
import React from "react";
import { cn } from "@/lib/utils";
import MobileChromeHeader, {
  type MobileChromeHeaderProps,
} from "@/components/common/MobileChromeHeader";
import PageHeader, { type PageHeaderProps } from "@/components/layout/PageHeader";
import ContentCanvas, { type ContentCanvasProps } from "@/components/layout/ContentCanvas";

export type ModuleShellProps = {
  /** 移动顶栏标题 */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 桌面 PageHeader 标题（默认同 title） */
  desktopTitle?: React.ReactNode;
  onBack?: () => void;
  /** 移动顶栏右侧 */
  mobileRight?: React.ReactNode;
  /** 桌面右侧操作 */
  desktopActions?: React.ReactNode;
  /** 桌面左侧（返回之外的 leading） */
  desktopLeading?: React.ReactNode;
  /** 顶栏下方（分段、筛选摘要等） */
  subheader?: React.ReactNode;
  children: React.ReactNode;
  /** ContentCanvas 透传 */
  canvasClassName?: string;
  canvasProps?: Omit<ContentCanvasProps, "children" | "className">;
  /** 是否使用 ContentCanvas 包裹 children（默认 true） */
  withCanvas?: boolean;
  className?: string;
  /** 材料化顶栏：半透明 + blur（默认 true） */
  materialHeader?: boolean;
  mobileHeaderProps?: Partial<MobileChromeHeaderProps>;
  pageHeaderProps?: Partial<PageHeaderProps>;
};

export default function ModuleShell({
  title,
  subtitle,
  desktopTitle,
  onBack,
  mobileRight,
  desktopActions,
  desktopLeading,
  subheader,
  children,
  canvasClassName,
  canvasProps,
  withCanvas = true,
  className,
  materialHeader = true,
  mobileHeaderProps,
  pageHeaderProps,
}: ModuleShellProps) {
  const headerMaterial = materialHeader
    ? "bg-app-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-app-bg/70"
    : undefined;

  return (
    <div
      className={cn(
        "flex-1 flex flex-col min-h-0 overflow-hidden bg-app-bg",
        className,
      )}
    >
      <MobileChromeHeader
        variant="stack"
        stackAction="back"
        title={title}
        subtitle={typeof subtitle === "string" ? subtitle : undefined}
        onLeadingClick={onBack}
        right={mobileRight}
        className={headerMaterial}
        {...mobileHeaderProps}
      />
      <PageHeader
        mdOnly
        dense
        title={desktopTitle ?? title}
        subtitle={subtitle}
        leading={desktopLeading}
        actions={desktopActions}
        className={headerMaterial}
        {...pageHeaderProps}
      />
      {subheader}
      {withCanvas ? (
        <ContentCanvas className={cn("flex flex-col gap-3 pb-24 md:pb-8", canvasClassName)} {...canvasProps}>
          {children}
        </ContentCanvas>
      ) : (
        children
      )}
    </div>
  );
}
