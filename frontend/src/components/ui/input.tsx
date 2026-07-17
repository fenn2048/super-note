import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-input border border-app-border bg-app-elevated px-3.5 py-2 text-sm text-tx-primary shadow-xs",
          "transition-all duration-fast ease-soft",
          "placeholder:text-tx-quaternary",
          "hover:border-app-border",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/30 focus-visible:border-accent-primary/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
