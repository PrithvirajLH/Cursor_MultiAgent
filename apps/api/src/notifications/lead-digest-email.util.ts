import type { DigestTicket, LeadDigest } from './lead-digest.service';

/**
 * Render one lead's digest as a subject, a plain-text body and an HTML body
 * (card 1.16).
 *
 * ⚠️ A PURE FUNCTION, taking data and returning strings, so the wording is
 * assertable without a database, a mail server or a running app. It also means
 * an in-app digest can reuse `collectDigests()` without inheriting any of this.
 *
 * The subject leads with the counts, because on a phone that is all anybody
 * reads: "3 breached, 1 at risk, 5 unassigned" tells a lead whether to open it
 * before they have opened it. A section with nothing in it is omitted entirely
 * rather than printed as "0" - card 1.42's fatigue lesson applies inside the
 * email as well as to whether it is sent at all.
 */
export function buildLeadDigestEmail(digest: LeadDigest): {
  subject: string;
  text: string;
  html: string;
} {
  const parts: string[] = [];
  if (digest.breached.length > 0) {
    parts.push(`${digest.breached.length} breached`);
  }
  if (digest.atRisk.length > 0) {
    parts.push(`${digest.atRisk.length} at risk`);
  }
  if (digest.unassigned.length > 0) {
    parts.push(`${digest.unassigned.length} unassigned`);
  }
  const subject = `Your team today: ${parts.join(', ')}`;
  const sections: Array<[string, DigestTicket[]]> = [
    ['Breached', digest.breached],
    ['At risk within the hour', digest.atRisk],
    ['Unassigned', digest.unassigned],
  ];
  const textLines: string[] = [`Good morning ${digest.leadName},`, ''];
  const htmlParts: string[] = [
    `<p>Good morning ${escapeHtml(digest.leadName)},</p>`,
  ];
  for (const [heading, tickets] of sections) {
    if (tickets.length === 0) {
      continue;
    }
    textLines.push(`${heading} (${tickets.length}):`);
    htmlParts.push(
      `<h3>${escapeHtml(heading)} (${tickets.length})</h3><ul>`,
    );
    for (const ticket of tickets) {
      // `displayId` is nullable in the schema, so fall back to the id rather
      // than printing "null" at somebody at seven in the morning.
      const label = ticket.displayId ?? ticket.id;
      textLines.push(`  ${label}  ${ticket.subject}`);
      htmlParts.push(
        `<li><strong>${escapeHtml(label)}</strong> ` +
          `${escapeHtml(ticket.subject)}</li>`,
      );
    }
    textLines.push('');
    htmlParts.push('</ul>');
  }
  textLines.push('This is a once-a-day summary. Everything is on the platform.');
  htmlParts.push(
    '<p>This is a once-a-day summary. Everything is on the platform.</p>',
  );
  return {
    subject,
    text: textLines.join('\n'),
    html: htmlParts.join(''),
  };
}

/** Minimal escaping: a ticket subject is user-supplied text in an HTML email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
