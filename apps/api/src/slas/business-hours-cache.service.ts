import { Injectable } from '@nestjs/common';
import { parsePositiveInt } from '../common/config.utils';
import type { BusinessHoursSettings } from '../tickets/ticket-sla-calculation.service';

/** Cache slot for the organisation default calendar (teamId is null). */
const GLOBAL_CACHE_KEY = '__global__';

type CacheEntry = {
  value: BusinessHoursSettings;
  checkedAtMs: number;
};

/**
 * TTL cache of resolved business-hours calendars, keyed by team.
 *
 * This is keyed rather than single-slot on purpose. Once calendars differ per
 * team, one shared slot serves one team's timezone to another, which presents
 * as intermittently wrong SLA due dates depending on which team was queried
 * first — close to undiagnosable in production.
 *
 * It lives in SlasModule rather than beside the calculation service because
 * both the reader (TicketSlaCalculationService) and the writer (SlasService)
 * need it, and TicketsModule already imports SlasModule. Putting it the other
 * way round would make the two modules circular.
 *
 * KNOWN LIMITATION — this cache is per-process. Invalidation clears the Map in
 * one instance only. On Container Apps with more than one replica, an edit made
 * on instance A leaves instances B..N serving the superseded calendar until
 * their own entry ages out, so a calendar change can take up to the TTL below
 * to become uniform.
 *
 * The damage outlives the staleness. Due dates are computed once and persisted
 * on the ticket at creation, not recalculated on read, so a ticket created on a
 * replica holding a stale calendar keeps the wrong deadline for its whole life.
 * Cache expiry does not heal it, and nothing later recomputes it — the ticket
 * has to be corrected by hand. The stale window is bounded; the tickets it
 * mis-dates are not.
 *
 * Closing this properly means either a shared cache (Redis) or a broadcast
 * invalidation over Web PubSub; neither is in scope here.
 */
@Injectable()
export class BusinessHoursCacheService {
  // NOTE: SCHEMA_CHECK_CACHE_TTL_MS (default 5 minutes) is borrowed from the
  // schema-probe caches in routing.service.ts and tickets.service.ts. Those
  // cache "does this column exist", which changes only on deploy; this caches
  // admin-editable business data. One knob now governs both, so tuning either
  // moves the other. It deserves its own variable — left as-is only to keep
  // this change additive.
  private readonly ttlMs = parsePositiveInt(
    process.env.SCHEMA_CHECK_CACHE_TTL_MS,
    300_000,
  );

  private readonly entries = new Map<string, CacheEntry>();

  /** Resolved calendar for this team, or null when absent or past its TTL. */
  read(teamId: string | null): BusinessHoursSettings | null {
    const entry = this.entries.get(this.buildKey(teamId));
    if (!entry) {
      return null;
    }
    if (Date.now() - entry.checkedAtMs > this.ttlMs) {
      return null;
    }
    return entry.value;
  }

  /** Cache the resolved calendar for this team. */
  write(teamId: string | null, value: BusinessHoursSettings): void {
    this.entries.set(this.buildKey(teamId), {
      value,
      checkedAtMs: Date.now(),
    });
  }

  /** Drop one team's slot, after that team's calendar is created or edited. */
  invalidateTeam(teamId: string): void {
    this.entries.delete(this.buildKey(teamId));
  }

  /**
   * Drop every slot. Required when the organisation default changes, because
   * any team without its own calendar has that default cached under its own
   * key and would otherwise keep serving the superseded value.
   */
  invalidateAll(): void {
    this.entries.clear();
  }

  private buildKey(teamId: string | null): string {
    return teamId ?? GLOBAL_CACHE_KEY;
  }
}
