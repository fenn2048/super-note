import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-button text-sm font-medium transition-all duration-fast ease-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-app-bg disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-accent-primary text-tx-inverse shadow-accent hover:brightness-105 hover:saturate-110 active:brightness-95",
        destructive:
          "bg-accent-danger text-white shadow-sm hover:brightness-105 active:brightness-95",
        outline:
          "border border-app-border bg-app-elevated/60 text-tx-primary shadow-xs hover:bg-app-hover hover:border-app-border",
        secondary:
          "bg-app-elevated text-tx-primary border border-app-border shadow-xs hover:bg-app-hover",
        ghost:
          "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
        link:
          "text-accent-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-button px-3 text-xs",
        lg: "h-11 rounded-button px-8 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
