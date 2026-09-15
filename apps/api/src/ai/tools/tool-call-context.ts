import type { AuthUser } from '../../auth/current-user.decorator';

/**
 * Who a tool call is allowed to act as (card 1.85).
 *
 * ⚠️ THIS IS PASSED DOWN THE CALL, NOT STORED ON THE SERVICE. The registry used
 * to keep the caller in a `currentUser` field set before each run, and
 * `ToolRegistryService` is a singleton — two intakes running at once overwrite
 * each other, and the loser's tools read the winner's user. Resolving the
 * subject from that field would have swapped a model-supplied id for another
 * user's id, which is worse, not better. An argument cannot race.
 *
 * Both fields are derived on the server from the authenticated request. Nothing
 * the model emits, and nothing in the requester's text, can reach either one.
 */
export interface ToolCallContext {
  /**
   * The signed-in caller, used for permission checks inside the tools.
   *
   * ⚠️ Null on the MCP transport (`src/mcp-server/server.ts`), which is a
   * separate token-gated process with no HTTP session — and `create_ticket`
   * refuses when it is null, exactly as it did when this was a field on the
   * registry that the MCP process never set. Keeping it nullable keeps that
   * refusal honest instead of inventing a service identity to satisfy a type.
   */
  readonly user: AuthUser | null;
  /**
   * Whose profile and ticket history the user tools may read.
   *
   * Normally the caller's own id. It differs only on `/api/ai/debug`, where an
   * OWNER — who can already see every ticket — may run the pipeline as a named
   * requester to reproduce a routing decision.
   */
  readonly subjectId: string;
}
