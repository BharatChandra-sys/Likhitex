import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

type ButtonVariant = NonNullable<ButtonProps["variant"]>;
type ButtonSize = NonNullable<ButtonProps["size"]>;

/**
 * Class-name recipe for the button look, usable from Server Components.
 *
 * `next/link` clones its child and injects an `onClick`, so a `<Button>` nested
 * inside a `<Link>` cannot be rendered from the server. Linking to a button
 * therefore means styling the `<Link>` itself, which is what this is for.
 */
export function buttonVariants({
  variant = "default",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none",
    "transition-[color,background-color,border-color,transform] duration-150 ease-out",
    "active:scale-[0.98] motion-reduce:active:scale-100",
    // Keyboard focus only; an outline (not a ring) survives forced-colors mode.
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    "disabled:opacity-50 disabled:pointer-events-none",
    "[&_svg]:shrink-0",

    {
      // Primary (Indigo) - Main actions
      "bg-primary text-on-primary hover:bg-primary/90": variant === "primary",

      // Default (Dark gray) - Secondary actions
      "bg-on-surface text-surface hover:bg-on-surface/90": variant === "default",

      // Secondary - Neutral bordered actions (Cancel, Import, pagination)
      "border border-border bg-surface-container-lowest text-on-surface hover:bg-surface-container-low":
        variant === "secondary",

      // Outline - Tertiary actions
      "border border-primary text-primary hover:bg-primary-fixed": variant === "outline",

      // Ghost - Subtle actions
      "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface":
        variant === "ghost",

      // Danger - Destructive actions
      "bg-error text-on-error hover:bg-error/90": variant === "danger",
    },

    {
      "h-7 px-2.5 text-xs": size === "sm",
      "h-8 px-3 text-xs": size === "md",
      "h-9 px-4 text-sm": size === "lg",
    },

    className
  );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };
