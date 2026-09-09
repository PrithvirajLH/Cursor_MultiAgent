import { buildLeadDigestEmail } from './lead-digest-email.util';
import type { LeadDigest } from './lead-digest.service';

function ticket(displayId: string | null, subject: string) {
  return { id: `id-${displayId ?? 'none'}`, displayId, subject, dueAt: null };
}

function digest(partial: Partial<LeadDigest> = {}): LeadDigest {
  return {
    leadId: 'lead-1',
    leadEmail: 'lead@company.com',
    leadName: 'Lead One',
    breached: [],
    atRisk: [],
    unassigned: [],
    ...partial,
  };
}

/**
 * Card 1.16 — what a lead actually reads at seven in the morning.
 */
describe('buildLeadDigestEmail (card 1.16)', () => {
  it('⚠️ leads with the counts, because that is all anybody reads on a phone', () => {
    const email = buildLeadDigestEmail(
      digest({
        breached: [ticket('IT_1', 'Printer down')],
        atRisk: [ticket('IT_2', 'VPN slow')],
        unassigned: [ticket('IT_3', 'New starter'), ticket('IT_4', 'Laptop')],
      }),
    );
    expect(email.subject).toBe('Your team today: 1 breached, 1 at risk, 2 unassigned');
  });

  it('⚠️ omits a section that is empty rather than printing a zero', () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. "0 breached" every
    // morning is the same fatigue card 1.42 removed, one level down: it trains
    // the reader to skip the mail, and then the one that matters is skipped too.
    const email = buildLeadDigestEmail(
      digest({ breached: [ticket('IT_1', 'Printer down')] }),
    );
    expect(email.subject).toBe('Your team today: 1 breached');
    expect(email.text).toContain('Breached (1)');
    expect(email.text).not.toContain('At risk');
    expect(email.text).not.toContain('Unassigned');
    expect(email.html).not.toContain('At risk');
  });

  it('names every ticket it counts', () => {
    const email = buildLeadDigestEmail(
      digest({ breached: [ticket('IT_9', 'Payroll export failed')] }),
    );
    expect(email.text).toContain('IT_9');
    expect(email.text).toContain('Payroll export failed');
    expect(email.html).toContain('IT_9');
  });

  it('falls back to the id when a ticket has no display id', () => {
    // `displayId` is nullable in the schema; printing "null" at somebody would
    // be worse than printing a uuid.
    const email = buildLeadDigestEmail(
      digest({ breached: [ticket(null, 'Old row')] }),
    );
    expect(email.text).toContain('id-none');
    expect(email.text).not.toContain('null');
  });

  it('⚠️ escapes a ticket subject, which is user-supplied text in an HTML email', () => {
    const email = buildLeadDigestEmail(
      digest({
        breached: [ticket('IT_5', '<script>alert("x")</script> & more')],
      }),
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&amp;');
    // The plain-text part keeps the original, which is correct: it is not markup.
    expect(email.text).toContain('<script>');
  });

  it('addresses the lead by name', () => {
    const email = buildLeadDigestEmail(
      digest({ leadName: 'Maria Chen', breached: [ticket('IT_1', 'x')] }),
    );
    expect(email.text).toContain('Good morning Maria Chen');
  });
});
