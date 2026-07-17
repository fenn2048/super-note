import * as React from "react"
import { cn } from "@/lib/utils"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-input border border-app-border bg-app-elevated px-3.5 py-2.5 text-sm text-tx-primary shadow-xs transition-all duration-fast ease-soft placeholder:text-tx-quaternary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/30 focus-visible:border-accent-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
