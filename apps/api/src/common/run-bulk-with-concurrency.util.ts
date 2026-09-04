/** How many tickets a bulk operation touches at once. */
const BULK_CONCURRENCY = 5;

export interface BulkResult {
  success: number;
  failed: number;
  succeededTicketIds: string[];
  failedTicketIds: string[];
  errors: { ticketId: string; message: string }[];
}

/**
 * Run one operation over many ticket ids, reporting PER TICKET.
 *
 * Lifted out of `TicketsService` by card 1.12 so the bulk macro endpoint can
 * use the same runner without a second copy of it. The behaviour is unchanged,
 * deliberately - four bulk endpoints already answer in this shape and the web
 * app's `failedTicketIdsFromBulkResult` reads it.
 *
 * Two properties matter:
 *
 *  - **Ids are deduplicated** (TICKET-005). The same ticket appearing twice in
 *    a selection would otherwise be mutated concurrently with itself.
 *  - **One failure does not stop the rest.** Across twenty tickets some will be
 *    in a state the operation cannot legally reach, or belong to a team the
 *    caller cannot write; all-or-nothing would let one of them block nineteen
 *    good ones while telling the agent nothing about which. Every failure comes
 *    back named, with its own message.
 */
export async function runBulkWithConcurrency(
  items: string[],
  operation: (ticketId: string) => Promise<unknown>,
): Promise<{ data: BulkResult }> {
  const uniqueItems = [...new Set(items)];
  const results: BulkResult = {
    success: 0,
    failed: 0,
    succeededTicketIds: [],
    failedTicketIds: [],
    errors: [],
  };
  const executing = new Set<Promise<void>>();
  for (const ticketId of uniqueItems) {
    const task = (async () => {
      try {
        await operation(ticketId);
        results.success++;
        results.succeededTicketIds.push(ticketId);
      } catch (err: unknown) {
        results.failed++;
        results.failedTicketIds.push(ticketId);
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.errors.push({ ticketId, message });
      }
    })();
    executing.add(task);
    void task.finally(() => executing.delete(task));
    if (executing.size >= BULK_CONCURRENCY) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return { data: results };
}
