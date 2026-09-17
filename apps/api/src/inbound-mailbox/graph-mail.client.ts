/** One recipient as Graph reports it. */
export type GraphRecipient = { address: string; name?: string | null };

/**
 * One attachment as Graph DESCRIBES it, with no content (card 1.116).
 *
 * ⚠️ METADATA ONLY, DELIBERATELY. Listing is cheap and downloading is not,
 * so the worker decides what it wants - is it a signature logo, is it over the
 * size limit - before spending anything on the bytes.
 *
 * `sizeBytes` is Graph's wire size: about a third larger than the real file,
 * because of base64 and MIME overhead. Good enough to choose by, and NOT the
 * number to hand downstream. See `fetchAttachmentContent`.
 */
export type GraphAttachmentMeta = {
  /** Graph's attachment id, needed to fetch the content. */
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Embedded by the sender's mail client - a pasted image, or a signature logo. */
  isInline: boolean;
};

/**
 * One attachment's downloaded content (card 1.129, fault B).
 *
 * ⚠️ `contentId` COSTS NOTHING EXTRA AND IS WHY THIS IS AN OBJECT. The download
 * is already a plain `GET /attachments/{id}` with no `$select` - card 1.119
 * proved that shape works and that a `$select` on a derived property does not -
 * so the full resource comes back either way and `contentId` is simply read off
 * the response that was already paid for. Asking Graph for it separately, or
 * adding it to `listAttachments`' `$select`, would mean either a second call or
 * a `microsoft.graph.fileAttachment/` cast that has never been tested against
 * the collection endpoint.
 */
export type GraphAttachmentContent = {
  /** Base64, exactly as Graph returned it. */
  contentBytes: string;
  /**
   * The `Content-ID` header the sender's client wrote, as `cid:` in the body
   * refers to it - WITHOUT the angle brackets Graph sometimes includes. Null
   * for an ordinary attached file, which is most of them.
   */
  contentId: string | null;
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
  /**
   * The body as Graph sent it, when Graph sent HTML (card 1.129, fault B).
   *
   * ⚠️ CARD 1.62 FLATTENS `bodyText` AT THIS BOUNDARY AND THAT DECISION STANDS.
   * This is the same content BEFORE that conversion, kept for one reason: the
   * `src="cid:..."` references live in it, and they are the only record of
   * WHERE in the sentence a pasted screenshot belonged. `htmlToText` drops the
   * `<img>` with every other tag, so by the time anything downstream sees the
   * body the position is gone.
   *
   * ⚠️ NOTHING STORES THIS. It exists so the worker can map `cid:` to a file
   * it has just ingested; the body that reaches the database is still text.
   */
  bodyHtml: string | null;
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
  /**
   * Whether Graph says this message has attachments (card 1.116).
   *
   * ⚠️ THIS REPLACED AN `attachments` ARRAY THAT COULD NEVER BE FILLED, and
   * that is the whole point of the change. A delta query does not return the
   * attachments collection and does not support `$expand`, so the old field was
   * `[]` on every message the system has ever received - which looked exactly
   * like "this email had no attachments" and hid the bug for months.
   *
   * A flag cannot lie the same way. If it is true, the worker goes and asks.
   */
  hasAttachments: boolean;
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

  /**
   * Describe one message's attachments WITHOUT downloading them (card 1.116).
   *
   * ⚠️ SEPARATE FROM `fetchDelta` ON PURPOSE. Called only after the worker
   * has decided the mail is addressed to us, so a mailbox full of other
   * people's copies costs nothing.
   */
  abstract listAttachments(
    mailbox: string,
    messageId: string,
  ): Promise<GraphAttachmentMeta[]>;

  /**
   * One attachment's content, base64, for a file already chosen.
   *
   * ⚠️ ONE CALL PER FILE, WHICH IS THE POINT. A failure here costs that one
   * attachment; it does not stall the page, and it must never lose the email.
   */
  abstract fetchAttachmentContent(
    mailbox: string,
    messageId: string,
    attachmentId: string,
  ): Promise<GraphAttachmentContent>;

  /** Whether the client has the configuration it needs to reach Graph. */
  abstract isConfigured(): boolean;

  /** A human-readable reason it is not configured, for the console. */
  abstract describeConfiguration(): string;
}
