import React from "react";
import { cn } from "@/lib/utils";

export default function ImportStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {[
        { n: 1, t: "上传解析" },
        { n: 2, t: "复核分类" },
        { n: 3, t: "确认导入" },
      ].map((s, i) => (
        <React.Fragment key={s.n}>
          {i > 0 && <div className="flex-1 h-px bg-app-border" />}
          <div
            className={cn(
              "flex items-center gap-1 shrink-0",
              step >= s.n ? "text-accent-primary" : "text-tx-tertiary",
            )}
          >
            <span
              className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium",
                step >= s.n ? "bg-accent-primary text-white" : "bg-app-hover",
              )}
            >
              {s.n}
            </span>
            {s.t}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
