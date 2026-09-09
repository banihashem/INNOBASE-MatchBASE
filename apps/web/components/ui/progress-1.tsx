"use client";

import type { ComponentProps } from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

// MB-UX-LIVE-001 L10: adapted from the supplied progress-1 component.
// A missing value is indeterminate; only measured completion may supply a value.
export function Progress({
  className,
  indicatorClassName,
  value = null,
  ...props
}: Omit<ComponentProps<typeof ProgressPrimitive.Root>, "max"> & {
  indicatorClassName?: string;
}) {
  const measured =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;
  return (
    <ProgressPrimitive.Root
      {...props}
      data-slot="progress"
      value={measured}
      max={100}
      className={["live-progress", className].filter(Boolean).join(" ")}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={["live-progress-indicator", indicatorClassName]
          .filter(Boolean)
          .join(" ")}
        style={
          measured === null
            ? undefined
            : { transform: `translateX(-${100 - measured}%)` }
        }
      />
    </ProgressPrimitive.Root>
  );
}
