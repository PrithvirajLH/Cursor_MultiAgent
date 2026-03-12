import { useEffect, useState } from "react";

/**
 * Real-time countdown to a target date. Updates every second.
 * @param targetIso - ISO date string or Date (null = no countdown)
 * @returns remaining milliseconds (>= 0 until past), and whether the target is in the past
 */
export function useCountdown(targetIso: string | Date | null): {
  remainingMs: number | null;
  isPast: boolean;
} {
  const [remainingMs, setRemainingMs] = useState<number | null>(() => {
    if (!targetIso) return null;
    const target =
      typeof targetIso === "string" ? new Date(targetIso) : targetIso;
    if (Number.isNaN(target.getTime())) return null;
    return Math.max(0, target.getTime() - Date.now());
  });

  useEffect(() => {
    if (!targetIso) {
      setRemainingMs(null);
      return;
    }
    const target =
      typeof targetIso === "string" ? new Date(targetIso) : targetIso;
    if (Number.isNaN(target.getTime())) {
      setRemainingMs(null);
      return;
    }

    const tick = () => {
      const ms = target.getTime() - Date.now();
      setRemainingMs(ms <= 0 ? 0 : ms);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetIso]);

  const isPast = remainingMs !== null && remainingMs <= 0;
  return {
    remainingMs: remainingMs === null ? null : Math.max(0, remainingMs),
    isPast,
  };
}
