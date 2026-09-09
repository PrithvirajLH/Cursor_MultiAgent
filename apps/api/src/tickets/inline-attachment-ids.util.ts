/**
 * The attachment ids an image was pasted into a message body as (card 1.48).
 *
 * An inline image is stored in the body HTML as
 * `<img data-attachment-id="…">` (RichTextEditor.tsx sets the attribute once
 * the upload resolves), with the file itself in a normal `Attachment` row.
 *
 * ⚠️ `Attachment` has NO `messageId` — it links only to `ticketId`
 * (schema.prisma:736-757). So there is no message-to-attachment relation to
 * cascade a redaction through, and the body text is the only record of which
 * files belonged to which message. Reading them back out of the HTML is
 * therefore not a shortcut; it is the only way.
 *
 * ⚠️ These ids come out of text an agent authored, so a caller MUST scope any
 * action by them to the ticket it already has access to. Nothing here can
 * validate that.
 */
export function inlineAttachmentIds(body: string | null | undefined): string[] {
  if (!body) {
    return [];
  }
  const ids = new Set<string>();
  // Both quote styles, because the body is hand-editable HTML rather than
  // something this codebase always serialises itself.
  const pattern = /data-attachment-id\s*=\s*("([^"]*)"|'([^']*)')/gi;
  for (const match of body.matchAll(pattern)) {
    const id = (match[2] ?? match[3] ?? '').trim();
    if (id !== '') {
      ids.add(id);
    }
  }
  return [...ids];
}
