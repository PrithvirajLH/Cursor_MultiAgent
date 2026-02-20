import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Shared Button component (7.1 fix).
 *
 * Provides a single source of truth for button styles across the app.
 * Use `variant` for the visual style and `size` for dimensions.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-blue-600 text-white hover:bg-blue-700',
        secondary:
          'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100',
        outline:
          'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
        ghost: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
        destructive: 'bg-rose-600 text-white hover:bg-rose-700',
        success: 'bg-emerald-600 text-white hover:bg-emerald-700',
        warning: 'bg-amber-600 text-white hover:bg-amber-700',
        dark: 'bg-slate-900 text-white hover:bg-slate-800',
        link: 'text-blue-600 hover:text-blue-700 underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 rounded-lg px-2.5 text-xs gap-1',
        sm: 'h-8 rounded-lg px-3 text-xs gap-1.5',
        md: 'h-10 rounded-xl px-4 text-sm gap-2',
        lg: 'h-11 rounded-xl px-5 text-sm gap-2',
        icon: 'h-10 w-10 rounded-xl',
        'icon-sm': 'h-8 w-8 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
