import { TicketPriority } from '@prisma/client';

export const DEFAULT_SLA_CONFIG: Record<
  TicketPriority,
  { firstResponseHours: number; resolutionHours: number }
> = {
  [TicketPriority.SEV1]: { firstResponseHours: 1, resolutionHours: 4 },
  [TicketPriority.SEV2]: { firstResponseHours: 4, resolutionHours: 24 },
  [TicketPriority.SEV3]: { firstResponseHours: 8, resolutionHours: 72 },
  [TicketPriority.SEV4]: { firstResponseHours: 24, resolutionHours: 168 },
};

/**
 * Shared utility for parsing environment variable values into positive integers.
 *
 * Centralised here to eliminate duplication across main.ts, app.module.ts,
 * route-throttler.guard.ts, reports.service.ts, and the various ticket services.
 *
 * @param value - The raw string value (typically from `process.env`).
 * @param fallback - The default value if `value` is undefined, empty, or not a positive integer.
 * @returns The parsed positive integer, or `fallback`.
 */
export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
