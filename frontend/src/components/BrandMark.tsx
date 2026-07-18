/**
 * 蜉蝣品牌标 —— 全站统一引用方案 A（靛蓝涟漪 + 蜉蝣翅）
 */
import { cn } from "@/lib/utils";

export type BrandMarkProps = {
  className?: string;
  size?: number;
  /** 是否显示「蜉蝣」字样 */
  withWordmark?: boolean;
  wordmarkClassName?: string;
};

const MARK_SRC = "/brand/fuyou-icon-512.png";

export default function BrandMark({
  className,
  size = 40,
  withWordmark = false,
  wordmarkClassName,
}: BrandMarkProps) {
  return (
    <div className={cn("inline-flex items-center gap-2.5", className)}>
      <img
        src={MARK_SRC}
        alt="蜉蝣"
        width={size}
        height={size}
        className="rounded-[22%] shadow-sm object-cover shrink-0"
        draggable={false}
      />
      {withWordmark && (
        <span
          className={cn(
            "text-lg font-bold tracking-tight text-tx-primary",
            wordmarkClassName,
          )}
        >
          蜉蝣
        </span>
      )}
    </div>
  );
}

export function brandMarkUrl(kind: "512" | "1024" | "splash" = "512"): string {
  if (kind === "1024") return "/brand/fuyou-icon-1024.png";
  if (kind === "splash") return "/brand/fuyou-splash-default.png";
  return MARK_SRC;
}
