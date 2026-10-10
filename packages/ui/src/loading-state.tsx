import { forwardRef, useEffect, useState, type ComponentProps } from "react";
import { cn } from "./cn.js";

/**
 * 3x3 chevron wavefront delays driving rightward (ms).
 * Row 0: [90, 180, 270]
 * Row 1: [0, 90, 180]
 * Row 2: [90, 180, 270]
 */
const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

/**
 * Clockwise perimeter traversal order for the Orbit pattern.
 * Center cell (index 4) remains stationary and dimmed.
 */
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

export interface LoaderPattern {
  delays: (number | null)[];
  dur: number;
  round: boolean;
}

export const LOADING_STATE_PATTERNS: Record<"Drive" | "Dots" | "Orbit", LoaderPattern> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

export interface LoaderGridProps extends ComponentProps<"span"> {
  delays?: (number | null)[];
  dur?: number;
  round?: boolean;
  variant?: "Drive" | "Dots" | "Orbit";
}

/**
 * Standalone 3x3 pixel-grid loader.
 * Square or circular cells pulsed by keyframe animation with staggered delay,
 * styled in the active system theme color (`bg-primary`).
 */
export const LoaderGrid = forwardRef<HTMLSpanElement, LoaderGridProps>(function LoaderGrid(
  { delays: customDelays, dur: customDur, round: customRound, variant, className, style, ...rest },
  ref,
) {
  const pattern = variant
    ? (LOADING_STATE_PATTERNS[variant] ?? LOADING_STATE_PATTERNS.Drive)
    : null;
  const delays = customDelays ?? pattern?.delays ?? chevron;
  const dur = customDur ?? pattern?.dur ?? 650;
  const round = customRound ?? pattern?.round ?? false;

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-slot="loader-grid"
      className={cn("grid shrink-0 grid-cols-[repeat(3,4px)]", className)}
      style={{ gap: "1.5px", ...style }}
      {...rest}
    >
      {delays.map((delay, index) => (
        <span
          key={index}
          data-slot="loader-grid-cell"
          className={cn("size-1 bg-primary motion-reduce:animate-none!", round && "rounded-full")}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation:
              delay === null ? "none" : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
});

/**
 * Renders as "X.Xs" for <60s, and "Xm X.Xs" thereafter.
 * A finite startedAt is a Unix epoch timestamp in milliseconds, measured against
 * the wall clock and clamped at zero. Otherwise, counts 100ms ticks, pausing
 * while disabled and continuing the count when enabled again.
 */
export function useElapsedTimer(enabled = true, startedAt?: number): string {
  const [ds, setDs] = useState(0);
  const [, refresh] = useState(0);
  const start = startedAt !== undefined && Number.isFinite(startedAt) ? startedAt : undefined;

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (start === undefined) setDs((d) => d + 1);
      else refresh((tick) => tick + 1);
    }, 100);
    return () => clearInterval(t);
  }, [enabled, start]);

  const total =
    start === undefined ? ds / 10 : Math.round(Math.max(0, Date.now() - start) / 100) / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export type LoadingStateVariant = "Drive" | "Dots" | "Orbit";

export interface LoadingStateProps extends ComponentProps<"div"> {
  /**
   * The status label. Defaults to "Churning".
   */
  label?: string;
  /** Whether to render the visible label. Defaults to true. Does not affect ariaLabel. */
  showLabel?: boolean;
  /** Classes applied only to the visible label. */
  labelClassName?: string;
  /**
   * Loader animation pattern:
   * - `Drive` (default): square cells, chevron wavefront driving right
   * - `Dots`: circular cells, chevron wavefront driving right
   * - `Orbit`: square cells, perimeter comet lapping the grid
   */
  variant?: LoadingStateVariant;
  /**
   * Whether to display the live elapsed timer in tabular figures. Defaults to true.
   */
  elapsed?: boolean;
  /** Unix epoch milliseconds for wall-clock elapsed time. Non-finite values use tick counting. */
  startedAt?: number;
  /**
   * Accessible announcement label for assistive tech.
   */
  ariaLabel?: string;
}

/**
 * LoadingState — pixel-grid loader with shimmering label and live elapsed timer.
 * Automatically adapts to the active system theme color (`primary`: Ember orange,
 * Ash coral, Slate blue, and Dark mode).
 *
 * Reduced motion freezes the animated grid to its dim resting state and disables
 * the text shimmer while allowing the elapsed timer to continue ticking.
 */
export const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(function LoadingState(
  {
    label = "Churning",
    showLabel = true,
    labelClassName,
    variant = "Drive",
    elapsed = true,
    startedAt,
    ariaLabel,
    className,
    ...rest
  },
  ref,
) {
  const liveElapsed = useElapsedTimer(elapsed, startedAt);
  const pattern = LOADING_STATE_PATTERNS[variant] ?? LOADING_STATE_PATTERNS.Drive;

  const labelEl = showLabel ? (
    <span
      data-slot="loading-state-label"
      className={cn(
        "bg-clip-text text-badge text-transparent motion-reduce:animate-none! motion-reduce:text-muted-foreground",
        labelClassName,
      )}
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--muted-foreground) 35%, var(--primary) 50%, var(--muted-foreground) 65%)",
        backgroundSize: "200% 100%",
        animation: "shimmer-text 1.4s linear infinite",
      }}
    >
      {label}
    </span>
  ) : null;

  // Elapsed ticks are visual feedback, not status announcements.
  const elapsedEl = elapsed ? (
    <span
      data-slot="loading-state-elapsed"
      aria-hidden="true"
      className="shrink-0 whitespace-nowrap font-mono text-aux text-muted-foreground tabular-nums"
    >
      {liveElapsed}
    </span>
  ) : null;

  return (
    <div
      ref={ref}
      role="status"
      aria-label={ariaLabel}
      data-slot="loading-state"
      data-variant={variant}
      className={cn("flex w-fit items-center gap-2", className)}
      {...rest}
    >
      <LoaderGrid {...pattern} />
      {labelEl}
      {elapsedEl}
    </div>
  );
});

export default LoadingState;
