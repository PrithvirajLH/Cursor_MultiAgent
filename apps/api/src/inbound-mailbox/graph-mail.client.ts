/** One recipient as Graph reports it. */
export type GraphRecipient = { address: string; name?: string | null };

/** One attachment as Graph reports it, already base64 in `contentBytes`. */
export type GraphAttachment = {
  name: string;
  contentType: string;
  sizeBytes: number;
  contentBytes?: string | null;
};

/**
 * One mail message, reduced to what ingestion needs.
 *
 * Deliberately NOT Graph's own shape. The worker and its tests speak this
 * type, so the whole card is exercisable without the SDK, without a network
 * and without the permission that has not arrived yet.
 */
export type GraphMailMessage = {
  /** Graph's own item id, used to move the message. Not the RFC message id. */
  id: string;
  /** RFC 5322 `Message-ID`. This is what inbound idempotency keys on. */
  internetMessageId: string;
  subject: string;
  bodyText: string;
  from: GraphRecipient;
  toRecipients: GraphRecipient[];
  ccRecipients: GraphRecipient[];
  /**
   * `Delivered-To`, and any other envelope recipient Graph exposes through
   * `internetMessageHeaders`. Often the ONLY witness that we were addressed,
   * when a forwarding rule rewrote the envelope.
   */
  deliveredTo: string[];
  inReplyTo?: string | null;
  references?: string | null;
  /** Loop-protection headers (card 1.22). Absent is normal. */
  autoSubmitted?: string | null;
  autoResponseSuppress?: string | null;
  precedence?: string | null;
  listId?: string | null;
  returnPath?: string | null;
  attachments: GraphAttachment[];
};

/** One page of a delta query. */
export type GraphDeltaPage = {
  messages: GraphMailMessage[];
  /**
   * The cursor to store and resume from. Present on the LAST page of a run;
   * `nextLink` is present instead while more pages remain.
   */
  deltaLink?: string | null;
  nextLink?: string | null;
};

/**
 * The seam between the worker and Microsoft Graph (card 1.24).
 *
 * ⚠️ AN ABSTRACT CLASS, NOT AN INTERFACE, because Nest needs a runtime value
 * to inject against. It is the DI token and the contract at once.
 *
 * ⚠️ **THE POINT OF THIS FILE IS THAT NOTHING ELSE NEEDS GRAPH TO BE TESTED.**
 * The permission (`Mail.ReadWrite`, scoped to one mailbox) had not arrived when
 * this was built, so every behaviour that matters - the cursor surviving a
 * restart, not ingesting twice, not moving a message that failed to store - is
 * proved against a fake implementation of these four methods. If something
 * cannot be tested locally, the fix belongs on this side of the seam.
 *
 * ⚠️ **There is deliberately no "pretend it worked" mode.** A worker that
 * silently no-ops in production is worse than one that fails loudly: the mail
 * is still arriving and nobody is told it is being dropped. When the switch is
 * on and Graph is unreachable, the implementation throws and the worker records
 * the failure on the Operations console.
 */
export abstract class GraphMailClient {
  /**
   * Fetch the next page of changes for a mailbox.
   *
   * @param mailbox The address to poll.
   * @param link A stored `deltaLink` to resume from, a `nextLink` to continue
   *   a multi-page run, or null to begin a fresh delta.
   */
  abstract fetchDelta(
    mailbox: string,
    link: string | null,
  ): Promise<GraphDeltaPage>;

  /**
   * Move one message into the Processed folder.
   *
   * ⚠️ Called ONLY after the message is safely stored. See the worker.
   */
  abstract moveToProcessed(mailbox: string, messageId: string): Promise<void>;

  /** Whether the client has the configuration it needs to reach Graph. */
  abstract isConfigured(): boolean;

  /** A human-readable reason it is not configured, for the console. */
  abstract describeConfiguration(): string;
}
