import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary:
          "text-[hsl(var(--primary-foreground))] shadow-glow-sm hover:shadow-glow hover:brightness-110 active:brightness-95",
        secondary:
          "border border-border bg-card text-foreground/80 hover:bg-accent hover:text-foreground hover:border-white/[0.14]",
        outline:
          "border border-border bg-transparent text-foreground/75 hover:bg-accent hover:text-foreground hover:border-white/[0.14]",
        ghost:
          "text-foreground/65 hover:bg-accent hover:text-foreground",
        destructive:
          "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:bg-[hsl(var(--destructive)/0.85)]",
        success:
          "bg-[hsl(var(--status-open-bg))] text-[hsl(var(--status-open))] border border-[hsl(var(--status-open)/0.3)] hover:bg-[hsl(var(--status-open)/0.2)]",
        warning:
          "bg-[hsl(var(--status-waiting-bg))] text-[hsl(var(--status-waiting))] border border-[hsl(var(--status-waiting)/0.3)] hover:bg-[hsl(var(--status-waiting)/0.2)]",
        dark:
          "bg-muted text-foreground hover:bg-accent border border-border",
        link:
          "text-[hsl(var(--primary))] hover:text-[hsl(var(--primary)/0.8)] underline-offset-4 hover:underline",
      },
      size: {
        xs:      "h-7  rounded-md   px-2.5 text-xs  gap-1",
        sm:      "h-8  rounded-lg   px-3   text-xs  gap-1.5",
        md:      "h-9  rounded-lg   px-4   text-sm  gap-2",
        lg:      "h-11 rounded-xl   px-5   text-sm  gap-2",
        icon:    "h-9  w-9  rounded-lg",
        "icon-sm": "h-8 w-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
    compoundVariants: [
      {
        variant: "primary",
        className: "",
      },
    ],
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, style, ...props }, ref) => {
    const isPrimary = !variant || variant === "primary";
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        style={
          isPrimary
            ? {
                background:
                  "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(217 91% 60%) 100%)",
                ...style,
              }
            : style
        }
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
