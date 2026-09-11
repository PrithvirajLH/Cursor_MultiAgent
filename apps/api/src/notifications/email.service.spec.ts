import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { EmailService } from './email.service';
import type { EmailSuppressionService } from './email-suppression.service';
import {
  REPLY_ABOVE_MARKER,
  stripQuotedReply,
} from './quoted-reply.util';

const sendMail = jest.fn().mockResolvedValue({ messageId: 'sent', rejected: [] });

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail })) },
}));

const createTransport = nodemailer.createTransport as unknown as jest.Mock;
const isSuppressed = jest.fn().mockResolvedValue(false);
const recordFailure = jest.fn().mockResolvedValue(undefined);

function suppressionStub(): EmailSuppressionService {
  return { isSuppressed, recordFailure } as unknown as EmailSuppressionService;
}

const SMTP: Record<string, string> = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'user',
  SMTP_PASS: 'pass',
  SMTP_FROM: 'helpdesk@csnhc.com',
};

function buildService(): EmailService {
  const config = {
    get: (key: string) => SMTP[key],
  } as unknown as ConfigService;
  return new EmailService(config, suppressionStub());
}

function lastCall() {
  return sendMail.mock.calls[sendMail.mock.calls.length - 1][0] as {
    to: string[];
    cc?: string[];
    text: string;
    html?: string;
    from?: string;
    replyTo?: string;
  };
}

/**
 * Every recipient the transport was ever handed, To and CC alike.
 *
 * Card 1.22's invariant test read only `to`. Once a public reply grew a CC
 * (card 1.33) that would have passed while leaking an intended address into
 * the CC field, so it reads both.
 */
function everyRecipientEverSent(): string[] {
  return sendMail.mock.calls.flatMap((call) => {
    const message = call[0] as { to: string[]; cc?: string[] };
    return [...message.to, ...(message.cc ?? [])];
  });
}

const PREHEADER_TEXT = 'Thanks Dana - can you send a corrected timesheet?';

/** The shape buildPublicReplyHtmlBody produces: a document, preheader first. */
const REPLY_DOCUMENT = [
  '<!DOCTYPE html>',
  '<html>',
  `  <body style="margin:0;padding:0;">`,
  `    <div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;mso-hide:all;">${PREHEADER_TEXT}</div>`,
  '    <table role="presentation"><tr><td>The visible message.</td></tr></table>',
  '  </body>',
  '</html>',
].join('\n');

describe('EmailService', () => {
  const previousPilot = process.env.EMAIL_TEST_RECIPIENTS;

  beforeEach(() => {
    sendMail.mockClear();
    createTransport.mockClear();
    isSuppressed.mockClear().mockResolvedValue(false);
    recordFailure.mockClear().mockResolvedValue(undefined);
    sendMail.mockResolvedValue({ messageId: 'sent', rejected: [] });
    delete process.env.EMAIL_TEST_RECIPIENTS;
  });

  afterAll(() => {
    if (previousPilot === undefined) delete process.env.EMAIL_TEST_RECIPIENTS;
    else process.env.EMAIL_TEST_RECIPIENTS = previousPilot;
  });

  it('sends to the intended recipient when no pilot list is set', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    expect(lastCall().to).toEqual(['sarah.chen@csnhc.com']);
  });

  it('puts the reply-above marker at the top of the body', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
    const call = lastCall();
    expect(call.text.startsWith(REPLY_ABOVE_MARKER)).toBe(true);
    expect(call.text).toContain('Hello');
    expect(call.html?.startsWith(`<p>${REPLY_ABOVE_MARKER}</p>`)).toBe(true);
  });

  it('REPLACES the recipient list in pilot mode and names who it would have gone to', async () => {
    process.env.EMAIL_TEST_RECIPIENTS = 'operator@csnhc.com';
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    const call = lastCall();
    expect(call.to).toEqual(['operator@csnhc.com']);
    expect(call.to).not.toContain('sarah.chen@csnhc.com');
    expect(call.text).toContain('would otherwise have gone to: sarah.chen@csnhc.com');
  });

  it('never lets an intended recipient reach sendMail while the pilot list is set', async () => {
    // The invariant, pinned rather than described: a spread of inputs, none of
    // which may put an intended address on the wire.
    process.env.EMAIL_TEST_RECIPIENTS = 'operator@csnhc.com, second@csnhc.com';
    const service = buildService();
    const intendedAddresses = [
      'sarah.chen@csnhc.com',
      'AGENT@csnhc.com',
      'lead@csnhc.com, other@csnhc.com',
      '  spaced@csnhc.com  ',
    ];
    for (const to of intendedAddresses) {
      await service.sendEmail({ to, subject: 'Ticket update', text: 'Hello' });
      // ...and again with a CC list, which is the field card 1.33 added.
      await service.sendEmail({
        to,
        cc: ['follower@csnhc.com', 'assignee@csnhc.com'],
        subject: 'Ticket update',
        text: 'Hello',
      });
    }
    const sent = everyRecipientEverSent().map((address) => address.toLowerCase());
    expect(sent.length).toBeGreaterThan(0);
    for (const address of sent) {
      expect(['operator@csnhc.com', 'second@csnhc.com']).toContain(address);
    }
  });

  it('sends one email with a To and a CC rather than one each', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      cc: ['follower@csnhc.com', 'assignee@csnhc.com'],
      subject: 'Ticket update',
      text: 'Hello',
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = lastCall();
    expect(call.to).toEqual(['sarah.chen@csnhc.com']);
    expect(call.cc).toEqual(['follower@csnhc.com', 'assignee@csnhc.com']);
  });

  it('drops a refused CC address without failing the message', async () => {
    // One bad colleague address must not stop the requester hearing back.
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      cc: ['follower@csnhc.com', 'outsider@gmail.com', 'no-reply@csnhc.com'],
      subject: 'Ticket update',
      text: 'Hello',
    });
    const call = lastCall();
    expect(call.to).toEqual(['sarah.chen@csnhc.com']);
    expect(call.cc).toEqual(['follower@csnhc.com']);
  });

  it('promotes a CC address to To when the To itself was refused', async () => {
    // An empty To with only CC recipients is a spam signal.
    await buildService().sendEmail({
      to: 'outsider@gmail.com',
      cc: ['follower@csnhc.com', 'assignee@csnhc.com'],
      subject: 'Ticket update',
      text: 'Hello',
    });
    const call = lastCall();
    expect(call.to).toEqual(['follower@csnhc.com']);
    expect(call.cc).toEqual(['assignee@csnhc.com']);
  });

  it('empties the CC in pilot mode so nothing intended can ride along', async () => {
    process.env.EMAIL_TEST_RECIPIENTS = 'operator@csnhc.com';
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      cc: ['follower@csnhc.com', 'assignee@csnhc.com'],
      subject: 'Ticket update',
      text: 'Hello',
    });
    const call = lastCall();
    expect(call.to).toEqual(['operator@csnhc.com']);
    expect(call.cc).toBeUndefined();
    // The pilot note still names everyone it would have reached.
    expect(call.text).toContain('sarah.chen@csnhc.com');
    expect(call.text).toContain('follower@csnhc.com');
  });

  describe('where the reply-above marker goes', () => {
    async function sentHtml(html: string): Promise<string> {
      await buildService().sendEmail({
        to: 'sarah.chen@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
        html,
      });
      return (sendMail.mock.calls[0][0] as { html: string }).html;
    }

    it('leaves the document well-formed, with nothing before the doctype', async () => {
      // It used to be prepended to the whole document, giving
      // `<p>marker</p><!DOCTYPE html>...` - quirks mode, and the marker outside
      // <html> where Outlook is least predictable.
      const html = await sentHtml(REPLY_DOCUMENT);
      expect(html.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html.indexOf(REPLY_ABOVE_MARKER)).toBeGreaterThan(
        html.indexOf('<body'),
      );
      expect(html.indexOf(REPLY_ABOVE_MARKER)).toBeLessThan(
        html.indexOf('</body>'),
      );
    });

    it('keeps the preheader ahead of the marker, so the preview is the question', async () => {
      const html = await sentHtml(REPLY_DOCUMENT);
      expect(html.indexOf(PREHEADER_TEXT)).toBeLessThan(
        html.indexOf(REPLY_ABOVE_MARKER),
      );
    });

    it('still emits the marker exactly once, so the trimmer has one cut point', async () => {
      const html = await sentHtml(REPLY_DOCUMENT);
      expect(html.split(REPLY_ABOVE_MARKER)).toHaveLength(2);
    });

    it('puts the pilot notice inside the body too', async () => {
      process.env.EMAIL_TEST_RECIPIENTS = 'operator@csnhc.com';
      const html = await sentHtml(REPLY_DOCUMENT);
      const notice = html.indexOf('would otherwise have gone to');
      expect(notice).toBeGreaterThan(html.indexOf('<body'));
      expect(notice).toBeLessThan(html.indexOf('</body>'));
    });

    it('falls back to prepending for a fragment with no body tag', async () => {
      // A missing marker would silently stop every reply being trimmed, which
      // is worse than a malformed fragment.
      const html = await sentHtml('<p>Just a fragment.</p>');
      expect(html.startsWith(`<p>${REPLY_ABOVE_MARKER}</p>`)).toBe(true);
    });

    it('ignores a hidden element that is not the first thing in the body', async () => {
      const document = [
        '<!DOCTYPE html>',
        '<html>',
        '  <body>',
        '    <p>Visible first.</p>',
        '    <div style="mso-hide:all;">Hidden later.</div>',
        '  </body>',
        '</html>',
      ].join('\n');
      const html = await sentHtml(document);
      expect(html.indexOf(REPLY_ABOVE_MARKER)).toBeLessThan(
        html.indexOf('Visible first.'),
      );
    });
  });

  describe('what the trimmer leaves of a quoted reply', () => {
    // The trade-off from insertIntoBody, measured rather than assumed. The
    // preheader sits above the marker, and stripQuotedReply keeps everything
    // above the FIRST marker it finds - so whether the preheader survives
    // depends entirely on whether the quoting client adds an attribution line
    // of its own above the quote.
    //
    // ⚠️ CARD 1.68 LEFT THIS LINE ALONE, on purpose. The footer is gone from
    // what we SEND, but this array is a fixture of an email coming BACK - a
    // requester's client quoting a message we sent them earlier. Every
    // acknowledgement already sitting in a mailbox still carries the footer,
    // so replies quoting one will keep arriving for months. Deleting it would
    // make the fixture less like the traffic, not more; and nothing here
    // asserts on the line, it is only the tail of the quoted copy.
    const quotedCopy = [
      PREHEADER_TEXT,
      REPLY_ABOVE_MARKER,
      'The visible message.',
      'Reply to this email',
    ];

    const inboundWith = (lead: string[]) =>
      [...lead, ...quotedCopy].join('\n');

    it.each([
      [
        'Gmail',
        ['On Wed, 2 Sep 2026 at 17:07, CSNHC Helpdesk <helpdesk@csnhc.com> wrote:'],
      ],
      [
        'Outlook header block',
        ['From: CSNHC Helpdesk <helpdesk@csnhc.com>', 'Sent: Wednesday 2 September'],
      ],
      // ⚠️ CARD 1.66 MADE THIS FIXTURE REALISTIC, and it was wrong before.
      // It used to be the underscore rule ALONE, which matched the bare
      // `/^_{5,}$/m` marker 1.66 removed. Real Outlook never sends the rule on
      // its own - it always follows it with the From:/Sent: header block, which
      // is what marker 3 matches and what actually does the cutting here now.
      // So the client shape this case is named for still trims; the old fixture
      // simply was not that shape.
      [
        'Outlook rule',
        [
          '________________________________',
          'From: CSNHC Helpdesk <helpdesk@csnhc.com>',
          'Sent: Wednesday 2 September',
        ],
      ],
      ['Original Message', ['-----Original Message-----']],
    ])('drops the preheader when %s quotes our email', (_client, lead) => {
      const shown = stripQuotedReply(
        inboundWith(['Yes, sending it now.', '', ...lead]),
      );
      expect(shown).toContain('Yes, sending it now.');
      expect(shown).not.toContain(PREHEADER_TEXT);
    });

    it('leaves the preheader behind only for a bare verbatim quote', () => {
      // Pinned so the residual is recorded rather than folklore. What survives
      // is the agent's own previous words, to someone who already received
      // them - confusing, not a disclosure. Reverse the order in
      // insertIntoBody if this ever matters more than the inbox preview.
      const shown = stripQuotedReply(inboundWith(['Yes, sending it now.', '']));
      expect(shown).toContain('Yes, sending it now.');
      expect(shown).toContain(PREHEADER_TEXT);
      expect(shown).not.toContain('The visible message.');
    });
  });

  describe('the named Reply-To (card 1.67 ①)', () => {
    // The per-ticket address a real send uses. `glovebox` is the production
    // mailbox and the token is the shape `buildReplyToAddress` emits.
    const TICKET_REPLY_TO =
      'glovebox+ticket-6f2a91c47b3d8e05a1@csnhc.com';

    it('⚠️ names the mailbox and leaves the address byte-identical', async () => {
      // THE REGRESSION ASSERTION. The address carries the ticket token; one
      // mangled byte and the requester's reply resolves to no ticket and is
      // filed as a brand-new one. So this checks the whole header literally,
      // and then checks the bracketed address against the input string on its
      // own - a `toContain` alone would pass on a truncated token.
      await buildService().sendEmail({
        to: 'dana@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
        replyTo: TICKET_REPLY_TO,
      });
      const { replyTo } = lastCall();
      expect(replyTo).toBe(`CSNHC Helpdesk <${TICKET_REPLY_TO}>`);
      const inBrackets = (replyTo as string).match(/<([^<>]+)>/)?.[1];
      expect(inBrackets).toBe(TICKET_REPLY_TO);
      // Not double-wrapped, and no stray quoting: `CSNHC Helpdesk` is two
      // atoms and needs none. One pair of brackets, one address.
      expect((replyTo as string).match(/</g)).toHaveLength(1);
      expect(replyTo).not.toContain('"');
    });

    it('⚠️ never carries the agent name, however the From is addressed', async () => {
      // The mailbox is the desk's. `Sarah Chen (CSNHC Helpdesk)` in a Reply-To
      // would claim a shared address belongs to one person - and every reply
      // to the ticket goes to the same place regardless of who last wrote.
      await buildService().sendEmail({
        to: 'dana@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
        agentDisplayName: 'Sarah Chen',
        replyTo: TICKET_REPLY_TO,
      });
      const { from, replyTo } = lastCall();
      expect(from).toBe('"Sarah Chen (CSNHC Helpdesk)" <helpdesk@csnhc.com>');
      expect(replyTo).toBe(`CSNHC Helpdesk <${TICKET_REPLY_TO}>`);
      expect(replyTo).not.toContain('Sarah');
    });

    it('names the configured fallback when the caller passes no reply address', async () => {
      // SMTP_REPLY_TO is unset here, so replyToAddress is SMTP_FROM.
      await buildService().sendEmail({
        to: 'dana@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      });
      expect(lastCall().replyTo).toBe('CSNHC Helpdesk <helpdesk@csnhc.com>');
    });

    it('emits no display name rather than an empty mailbox for a blank address', async () => {
      // `??` does not catch `''`, so without the blank check this would have
      // sent `CSNHC Helpdesk <>` - a malformed header, and the failure mode
      // the owner asked to be sure of, since a client cannot reply to it.
      await buildService().sendEmail({
        to: 'dana@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
        replyTo: '   ',
      });
      expect(lastCall().replyTo).toBe('');
      expect(lastCall().replyTo).not.toContain('CSNHC');
    });
  });

  it('refuses to send when every recipient is outside the allowed domains', async () => {
    await expect(
      buildService().sendEmail({
        to: 'someone@gmail.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow(/No allowed recipients/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('refuses to send to a no-reply address', async () => {
    await expect(
      buildService().sendEmail({
        to: 'no-reply@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow(/No allowed recipients/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('drops a refused address but still sends to the allowed ones', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com, outsider@gmail.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    expect(lastCall().to).toEqual(['sarah.chen@csnhc.com']);
  });

  it('still refuses everything when SMTP is not configured', async () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    await expect(
      new EmailService(config, suppressionStub()).sendEmail({
        to: 'sarah.chen@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('SMTP not configured');
  });
  it('requires STARTTLS when the connection is not implicitly secure', () => {
    buildService();
    const options = createTransport.mock.calls[0][0] as {
      secure: boolean;
      requireTLS: boolean;
      port: number;
    };
    // Port 587 with secure:false is STARTTLS. Without requireTLS nodemailer
    // silently falls back to plaintext and the SMTP password crosses the wire.
    expect(options.secure).toBe(false);
    expect(options.port).toBe(587);
    expect(options.requireTLS).toBe(true);
  });

  it('does not force STARTTLS when the port is already implicitly secure', () => {
    const config = {
      get: (key: string) => (key === 'SMTP_SECURE' ? 'true' : SMTP[key]),
    } as unknown as ConfigService;
    new EmailService(config, suppressionStub());
    const options = createTransport.mock.calls[0][0] as {
      secure: boolean;
      requireTLS: boolean;
    };
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it('sends from the generic desk identity when no agent is named', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    const call = sendMail.mock.calls[0][0] as { from: string };
    expect(call.from).toBe('CSNHC Helpdesk <helpdesk@csnhc.com>');
  });

  it('names the agent in the From line when one is supplied', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
      agentDisplayName: 'Sarah Chen',
    });
    const call = sendMail.mock.calls[0][0] as { from: string };
    expect(call.from).toBe('"Sarah Chen (CSNHC Helpdesk)" <helpdesk@csnhc.com>');
  });

  it('RFC-quotes an agent name containing a comma, end to end', async () => {
    // Covered in the util too, but this is the path that actually builds the
    // header: an unquoted comma would read as a second address.
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
      agentDisplayName: 'Chen, Sarah',
    });
    const call = sendMail.mock.calls[0][0] as { from: string };
    expect(call.from).toBe('"Chen, Sarah (CSNHC Helpdesk)" <helpdesk@csnhc.com>');
  });

  it('RFC-escapes an agent name containing a quote, end to end', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
      agentDisplayName: 'Sarah "Sam" Chen',
    });
    const call = sendMail.mock.calls[0][0] as { from: string };
    expect(call.from).toBe(
      '"Sarah \\"Sam\\" Chen (CSNHC Helpdesk)" <helpdesk@csnhc.com>',
    );
  });

  it('falls back to the generic identity when the name is blank', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
      agentDisplayName: '   ',
    });
    const call = sendMail.mock.calls[0][0] as { from: string };
    expect(call.from).toBe('CSNHC Helpdesk <helpdesk@csnhc.com>');
  });

  it('refuses a suppressed address', async () => {
    isSuppressed.mockResolvedValue(true);
    await expect(
      buildService().sendEmail({
        to: 'bounced@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow(/No allowed recipients/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('records a HARD failure when the server rejects permanently', async () => {
    const error = Object.assign(new Error('550 5.1.1 no such mailbox'), {
      responseCode: 550,
    });
    sendMail.mockRejectedValue(error);
    await expect(
      buildService().sendEmail({
        to: 'gone@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('550 5.1.1 no such mailbox');
    expect(recordFailure).toHaveBeenCalledWith(
      'gone@csnhc.com',
      'HARD',
      '550 5.1.1 no such mailbox',
    );
  });

  it('records a SOFT failure when the server is merely busy', async () => {
    const error = Object.assign(new Error('452 4.2.2 mailbox full'), {
      responseCode: 452,
    });
    sendMail.mockRejectedValue(error);
    await expect(
      buildService().sendEmail({
        to: 'full@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('452 4.2.2 mailbox full');
    expect(recordFailure).toHaveBeenCalledWith(
      'full@csnhc.com',
      'SOFT',
      '452 4.2.2 mailbox full',
    );
  });

  it('treats an unreadable failure as SOFT rather than silencing an address', async () => {
    sendMail.mockRejectedValue(new Error('socket hang up'));
    await expect(
      buildService().sendEmail({
        to: 'someone@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('socket hang up');
    expect(recordFailure).toHaveBeenCalledWith(
      'someone@csnhc.com',
      'SOFT',
      'socket hang up',
    );
  });

  it('records a recipient the server rejected while accepting the message', async () => {
    sendMail.mockResolvedValue({
      messageId: 'sent',
      rejected: ['gone@csnhc.com'],
      response: '550 5.1.1 unknown recipient',
    });
    await buildService().sendEmail({
      to: 'gone@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    expect(recordFailure).toHaveBeenCalledWith(
      'gone@csnhc.com',
      'HARD',
      '550 5.1.1 unknown recipient',
    );
  });
});
