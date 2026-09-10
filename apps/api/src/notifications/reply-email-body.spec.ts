import { ConfigService } from '@nestjs/config';
import { TicketStatus } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { NotificationsService } from './notifications.service';

const TICKET = {
  id: 'ticket-1',
  displayId: 'PA_20260901_001',
  number: 1,
  subject: 'Timesheet correction',
  status: TicketStatus.WAITING_ON_REQUESTER,
  requester: null,
};

const ACTOR = {
  id: 'user-1',
  email: 'vi.le@csnhc.com',
  displayName: 'Vi Le',
  role: 'AGENT',
} as unknown as AuthUser;

const SENT_AT = new Date('2026-09-02T15:02:00.000Z');

/** The two builders are private; the rest of the service is not exercised here. */
type Bodies = {
  buildPublicReplyHtmlBody: (
    ticket: typeof TICKET,
    actor: AuthUser,
    messageBody: string,
    sentAt?: Date,
  ) => string;
  buildPublicReplyTextBody: (
    ticket: typeof TICKET,
    actor: AuthUser,
    messageBody: string,
    sentAt?: Date,
  ) => string;
};

function buildBodies(): Bodies {
  const config = {
    get: (key: string) =>
      key === 'WEB_APP_URL' ? 'https://tickets.csnhc.com' : undefined,
  } as unknown as ConfigService;
  const service = new NotificationsService(
    {} as never,
    {} as never,
    {} as never,
    config,
    {} as never,
    { getBaseReplyToAddress: () => 'helpdesk@csnhc.com' } as never,
    {} as never,
  );
  return service as unknown as Bodies;
}

const html = (message: string, actor: AuthUser = ACTOR) =>
  buildBodies().buildPublicReplyHtmlBody(TICKET, actor, message, SENT_AT);

const text = (message: string, actor: AuthUser = ACTOR) =>
  buildBodies().buildPublicReplyTextBody(TICKET, actor, message, SENT_AT);

const MESSAGE =
  'Thanks Dana — so 08-31 is right but the punch is missing. Can you send a corrected timesheet?';

describe('the reply email body', () => {
  it('⚠️ carries the message and the author, and NO footer (card 1.68)', () => {
    // INVERTED by card 1.68. This asserted the footer was present; the owner
    // asked for it to go, so it now asserts the opposite - which is what keeps
    // the decision visible and stops the footer quietly coming back.
    const rendered = html(MESSAGE);
    expect(rendered).toContain('Vi Le');
    expect(rendered).toContain('corrected timesheet');
    expect(rendered).not.toContain('Reply to this email');
    expect(rendered).not.toContain('view online');
    // The horizontal rule went with it - with nothing below, it was a line to
    // nowhere.
    expect(rendered).not.toContain('border-top:1px solid #e5e7eb');
  });

  it('leaks no ticket status to the person who is waiting', () => {
    // The removed "Ticket details" block printed ticket.status raw, so a
    // requester was shown WAITING_ON_REQUESTER - the clearest single defect in
    // the old body.
    const rendered = html(MESSAGE);
    for (const status of Object.values(TicketStatus)) {
      expect(rendered).not.toContain(status);
    }
    expect(text(MESSAGE)).not.toContain(TicketStatus.WAITING_ON_REQUESTER);
  });

  it('has none of the parts the owner cut', () => {
    for (const rendered of [html(MESSAGE), text(MESSAGE)]) {
      expect(rendered).not.toContain('View Ticket');
      expect(rendered).not.toContain('Best regards');
      expect(rendered).not.toContain('Ticket details');
      expect(rendered).not.toContain('Update on your request');
      expect(rendered).not.toContain('We have an update');
      expect(rendered).not.toContain('Also copied');
      // The subject already carries the ticket id; the body must not repeat it.
      expect(rendered).not.toContain('PA_20260901_001');
    }
  });

  it('does not add a second reply-above marker', () => {
    // EmailService prepends it to both parts, and stripQuotedReply matches on
    // it - a second one would cut the message in half.
    expect(html(MESSAGE)).not.toContain('Reply above this line');
    expect(text(MESSAGE)).not.toContain('Reply above this line');
  });

  describe('the hidden preheader', () => {
    it('opens with the beginning of the message', () => {
      const rendered = html(MESSAGE);
      const preheader = rendered.slice(
        rendered.indexOf('mso-hide:all'),
        rendered.indexOf('</div>', rendered.indexOf('mso-hide:all')),
      );
      expect(preheader).toContain('Thanks Dana');
    });

    it('is invisible, by every property a client checks', () => {
      const rendered = html(MESSAGE);
      const line = rendered
        .split('\n')
        .find((row) => row.includes('mso-hide:all'));
      expect(line).toContain('display:none');
      expect(line).toContain('font-size:0');
      expect(line).toContain('line-height:0');
      expect(line).toContain('max-height:0');
      expect(line).toContain('overflow:hidden');
    });

    it('comes before anything else in the body', () => {
      const rendered = html(MESSAGE);
      expect(rendered.indexOf('mso-hide:all')).toBeLessThan(
        rendered.indexOf('<table'),
      );
    });

    it('truncates on a word boundary, not mid-word', () => {
      const long =
        'Could you please confirm whether the corrected timesheet covers the overnight differential as well, because payroll closes tomorrow';
      const rendered = html(long);
      const line = rendered
        .split('\n')
        .find((row) => row.includes('mso-hide:all')) as string;
      const preheader = line.slice(line.indexOf('>') + 1, line.indexOf('</div>'));
      expect(preheader.endsWith('…')).toBe(true);
      const withoutEllipsis = preheader.slice(0, -1);
      // Every word in the preheader is a whole word from the message.
      expect(long.startsWith(withoutEllipsis)).toBe(true);
      expect(long[withoutEllipsis.length]).toBe(' ');
    });

    it('collapses newlines so the preview is one line', () => {
      const rendered = html('First line.\n\nSecond line.');
      const line = rendered
        .split('\n')
        .find((row) => row.includes('mso-hide:all')) as string;
      expect(line).toContain('First line. Second line.');
    });

    it('escapes the message it was derived from', () => {
      // Easy to forget precisely because it is invisible.
      const rendered = html('<script>alert(1)</script> and & more');
      const line = rendered
        .split('\n')
        .find((row) => row.includes('mso-hide:all')) as string;
      expect(line).not.toContain('<script>');
      expect(line).toContain('&lt;script&gt;');
      expect(line).toContain('&amp;');
    });
  });

  describe('escaping', () => {
    it('escapes a script tag and an ampersand in the message', () => {
      const rendered = html('<script>alert("x")</script> Tom & Jerry');
      expect(rendered).not.toContain('<script>');
      expect(rendered).toContain('&lt;script&gt;');
      expect(rendered).toContain('Tom &amp; Jerry');
    });

    it('turns newlines into line breaks', () => {
      const rendered = html('One.\nTwo.');
      expect(rendered).toContain('One.<br />Two.');
    });

    it('does not let a quote or comma in a name break the label', () => {
      const actor = {
        ...ACTOR,
        displayName: 'Chen, Sarah "Sam"',
      } as unknown as AuthUser;
      const rendered = html(MESSAGE, actor);
      expect(rendered).toContain('Chen, Sarah &quot;Sam&quot;');
      expect(rendered).not.toContain('Sarah "Sam"');
      // The label markup is still one well-formed div.
      const line = rendered
        .split('\n')
        .find((row) => row.includes('text-transform:uppercase')) as string;
      expect(line.match(/<div/g)).toHaveLength(1);
      // No `&middot;` any more: the label is the name alone. The owner removed
      // the timestamp because every client already shows when the message
      // arrived, in the reader's own zone - ours restated it in UTC, worse.
      expect(line).not.toContain('&middot;');
    });
  });

  describe('the plain-text half', () => {
    it('has the same parts in the same order', () => {
      // ⚠️ REWRITTEN, not inverted, by card 1.68. This test was about ORDER -
      // it named the footer only to assert what followed what. With the footer
      // gone there is no "after" to check, so it now pins the order of what
      // remains: the author, then the message, and nothing after it.
      const rendered = text(MESSAGE);
      const lines = rendered.split('\n');
      expect(lines[0]).toBe('Vi Le');
      expect(rendered.indexOf(MESSAGE)).toBeGreaterThan(0);
      expect(rendered.trimEnd().endsWith(MESSAGE)).toBe(true);
    });

    it('⚠️ ends on the message, with no trailing link or blank (card 1.68)', () => {
      // INVERTED. This asserted the last line WAS the ticket URL. The text
      // half's bare URL was the plain-text equivalent of "view online", so it
      // went with the footer - and what is left has to end cleanly rather than
      // on a separator or an empty line a reader takes for truncation.
      const lines = text(MESSAGE).split('\n');
      const last = lines[lines.length - 1];
      expect(last).not.toBe('');
      expect(last).not.toContain('https://');
      expect(last).toContain('corrected timesheet');
    });

    it('draws no ASCII-art borders', () => {
      const rendered = text(MESSAGE);
      expect(rendered).not.toContain('---');
      expect(rendered).not.toContain('___');
      expect(rendered).not.toContain('┃');
    });
  });

  it('never appends conversation history', () => {
    // The recipient's own client quotes the previous message. A digest here
    // would sit on top of that and double every email.
    const rendered = html(MESSAGE);
    const occurrences = rendered.split('corrected timesheet').length - 1;
    // Once in the quote block, once in the hidden preheader - and nowhere else.
    expect(occurrences).toBeLessThanOrEqual(2);
    const bodyOnly = rendered.slice(rendered.indexOf('<table'));
    expect(bodyOnly.split('corrected timesheet').length - 1).toBe(1);
  });

  // REPLACED. This used to assert `Sep 2, 15:02 UTC` in both halves. The owner
  // removed the timestamp entirely on 2026-09-02: every mail client already
  // shows the arrival time in the reader's own zone, so a second one in UTC was
  // both redundant and visibly wrong (17:07 UTC on an email received at noon).
  // Removing it also deleted a timezone setting nobody had to configure.
  it('carries no timestamp of its own, in either half', () => {
    for (const rendered of [html(MESSAGE), text(MESSAGE)]) {
      expect(rendered).not.toMatch(/UTC/);
      expect(rendered).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });

  it('quotes the font family so strict clients keep the stack', () => {
    expect(html(MESSAGE)).toContain(`font-family:'Segoe UI', Arial, sans-serif`);
  });
});
