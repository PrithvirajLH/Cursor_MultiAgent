import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent text-[hsl(var(--primary-foreground))]",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-accent",
        destructive:
          "border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))]",
        outline:
          "border-border text-foreground/75",
        success:
          "border-[hsl(var(--status-open)/0.3)] bg-[hsl(var(--status-open-bg))] text-[hsl(var(--status-open))]",
        warning:
          "border-[hsl(var(--status-waiting)/0.3)] bg-[hsl(var(--status-waiting-bg))] text-[hsl(var(--status-waiting))]",
        info:
          "border-[hsl(var(--status-progress)/0.3)] bg-[hsl(var(--status-progress-bg))] text-[hsl(var(--status-progress))]",
        purple:
          "border-[hsl(var(--status-new)/0.3)] bg-[hsl(var(--status-new-bg))] text-[hsl(var(--status-new))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, style, ...props }: BadgeProps) {
  const isDefault = !variant || variant === "default";
  return (
    <div
      className={cn(badgeVariants({ variant }), className)}
      style={
        isDefault
          ? {
              background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(217 91% 60%) 100%)",
              ...style,
            }
          : style
      }
      {...props}
    />
  )
}

export { Badge, badgeVariants }
