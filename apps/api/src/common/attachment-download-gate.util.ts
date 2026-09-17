import { AttachmentScanStatus } from '@prisma/client';

/** Allowed, or refused with the sentence the caller should answer with. */
type AttachmentDownloadDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * May this file be served, given its scan state (card 0.7's AV gate)?
 *
 * ⚠️ ONE RULE, TWO CALLERS, AND THE SECOND ONE IS WHY THIS FILE EXISTS.
 * `TicketAttachmentService.assertAttachmentDownloadAllowed` has always guarded
 * the download route. Card 1.130 gives the file a second way out of the
 * building - embedded in an email - and the identical question answered in two
 * places is this project's recurring failure. So the answer lives here and both
 * ask it.
 *
 * ⚠️ `INFECTED` BLOCKS UNCONDITIONALLY, even with the gate switched off. It is
 * an explicit positive signal, and ignoring it would mean serving known-bad
 * files. Everything else is only blocked while scanning is enabled.
 *
 * @param scanStatus The attachment's recorded scan state.
 * @param scanEnabled Whether `ATTACHMENT_SCAN_ENABLED` is on.
 * @returns Whether it may be served, and why not when it may not.
 */
export function decideAttachmentDownload(
  scanStatus: AttachmentScanStatus,
  scanEnabled: boolean,
): AttachmentDownloadDecision {
  if (scanStatus === AttachmentScanStatus.CLEAN) {
    return { allowed: true };
  }
  if (scanStatus === AttachmentScanStatus.INFECTED) {
    return {
      allowed: false,
      reason: 'Attachment was flagged as infected and cannot be downloaded',
    };
  }
  if (!scanEnabled) {
    return { allowed: true };
  }
  if (scanStatus === AttachmentScanStatus.PENDING) {
    return {
      allowed: false,
      reason: 'Attachment scan is still pending; download is blocked',
    };
  }
  return {
    allowed: false,
    reason:
      'Attachment scan failed; download is blocked until the file is rescanned',
  };
}
