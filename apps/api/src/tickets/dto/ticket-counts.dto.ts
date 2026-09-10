import { IsOptional, Matches } from 'class-validator';

/** `YYYY-MM-DD` and nothing else. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query parameters for `GET /api/tickets/counts` (card 1.69 step 4).
 *
 * ⚠️ THIS IS THE WHOLE SURFACE, AND IT IS DATES ONLY. The card rules out a
 * count endpoint that accepts arbitrary client filters, because one that
 * bypassed the access filter would let a caller count tickets they cannot read
 * — an exfiltration oracle. Nothing here can name a requester, an assignee, a
 * team or a status, and every count runs under `accessConditionSql` regardless.
 * Do not extend this DTO with anything that selects tickets.
 *
 * ⚠️ `@Matches(DAY)` RATHER THAN `@IsISO8601()`, unlike the list DTO. A full
 * timestamp would reach `new Date(...)` and shift a badge by up to a day
 * depending on how the caller spelled it; the three counts these feed have
 * always been given a bare date. Narrow on purpose.
 *
 * The global ValidationPipe runs with `forbidNonWhitelisted: true`, so an
 * unknown query parameter here is a 400 rather than something silently ignored.
 */
export class TicketCountsDto {
  /** `createdFrom` for "SEV1 today" — the browser's local midnight. */
  @IsOptional()
  @Matches(DAY, { message: 'todayFrom must be YYYY-MM-DD' })
  todayFrom?: string;

  /** `updatedTo` for "Awaiting reply > 24h" — one day ago. */
  @IsOptional()
  @Matches(DAY, { message: 'awaitingUpdatedTo must be YYYY-MM-DD' })
  awaitingUpdatedTo?: string;

  /** `updatedFrom` for "Resolved this week" — seven days ago. */
  @IsOptional()
  @Matches(DAY, { message: 'resolvedUpdatedFrom must be YYYY-MM-DD' })
  resolvedUpdatedFrom?: string;
}
