/**
 * How many tickets one bulk call may carry (cards 1.12, 2.2).
 *
 * Card 1.12 chose 100 and spelled it as a literal `ArrayMaxSize(100)` in each
 * bulk DTO. Card 2.2 needed the same number on the READ side - `myOpenTickets`
 * returns ids meant to be handed straight to `bulkUnassign`, so a different
 * ceiling there would produce a request the validator rejects - and a number
 * that two files have to agree on is a number that belongs in one of them.
 */
export const BULK_TICKET_LIMIT = 100;
