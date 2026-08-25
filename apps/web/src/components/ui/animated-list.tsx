import React, { type ComponentPropsWithoutRef, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export function AnimatedListItem({
  children,
  staggerIndex = 0,
  staggerDelayMs = 50,
}: {
  children: React.ReactNode;
  staggerIndex?: number;
  staggerDelayMs?: number;
}) {
  // CSS cannot reach Framer's JS-driven springs, so the setting has to be
  // honoured here as well as in the global media query in styles.css.
  const shouldReduceMotion = useReducedMotion();

  const animations: React.ComponentProps<typeof motion.div> = shouldReduceMotion
    ? {
        // Appear in place: no scale, no spring, no stagger.
        initial: { scale: 1, opacity: 0 },
        animate: { scale: 1, opacity: 1, transition: { duration: 0 } },
        exit: { scale: 1, opacity: 0, transition: { duration: 0 } },
        transition: { duration: 0 },
      }
    : {
        initial: { scale: 0, opacity: 0 },
        animate: {
          scale: 1,
          opacity: 1,
          originY: 0,
          transition: {
            type: "spring",
            stiffness: 350,
            damping: 40,
            delay: (staggerIndex * staggerDelayMs) / 1000,
          },
        },
        exit: { scale: 0, opacity: 0 },
        transition: { type: "spring", stiffness: 350, damping: 40 },
      };

  return (
    <motion.div
      {...animations}
      layout={!shouldReduceMotion}
      className="mx-auto w-full"
    >
      {children}
    </motion.div>
  );
}

export interface AnimatedListProps extends ComponentPropsWithoutRef<"div"> {
  children: React.ReactNode;
  /** Stagger delay in ms between each item's enter animation (default 50). */
  staggerDelayMs?: number;
}

export const AnimatedList = React.memo(
  ({
    children,
    className,
    staggerDelayMs = 50,
    ...props
  }: AnimatedListProps) => {
    const childrenArray = useMemo(
      () => React.Children.toArray(children),
      [children],
    );

    return (
      <div
        className={cn(`flex flex-col items-center gap-4`, className)}
        {...props}
      >
        <AnimatePresence>
          {childrenArray.map((item, index) => (
            <AnimatedListItem
              key={(item as React.ReactElement).key ?? index}
              staggerIndex={index}
              staggerDelayMs={staggerDelayMs}
            >
              {item}
            </AnimatedListItem>
          ))}
        </AnimatePresence>
      </div>
    );
  },
);

AnimatedList.displayName = "AnimatedList";
