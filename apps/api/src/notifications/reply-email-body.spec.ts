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


/** The two builders are private; the rest of the service is not exercised here. */
type Bodies = {
  buildPublicReplyHtmlBody: (
    ticket: typeof TICKET,
    actor: AuthUser,
    messageBody: string,
    // ⚠️ CARD 1.130 REMOVED A DEAD ARGUMENT FROM THIS TYPE. It used to declare
    // a fourth `sentAt?: Date` and every call passed one - but card 1.68 took
    // the timestamp out of the body long ago, so the real method has had three
    // parameters for months and the fourth went nowhere. It stopped being
    // harmless the moment a real fourth parameter existed: the Date arrived as
    // `inlineImages` and every test in this file failed at once.
    inlineImages?: { attachmentId: string; cid: string }[],
  ) => string;
  buildPublicReplyTextBody: (
    ticket: typeof TICKET,
    actor: AuthUser,
    messageBody: string,
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

const html = (
  message: string,
  actor: AuthUser = ACTOR,
  inlineImages?: { attachmentId: string; cid: string }[],
) => buildBodies().buildPublicReplyHtmlBody(TICKET, actor, message, inlineImages);

const text = (message: string, actor: AuthUser = ACTOR) =>
  buildBodies().buildPublicReplyTextBody(TICKET, actor, message);

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

  describe('card 1.129 fault C - what the requester actually receives', () => {
    // The body measured on a real outbound email, 2026-09-16. The owner
    // screenshotted their inbox: this arrived as literal text.
    const PASTED =
      '<img data-temp-id="6bdd3f50-1111-4222-8333-444455556666" ' +
      'alt="image.png" class="" ' +
      'data-attachment-id="324e680b-1111-4222-8333-444455556666">see the img';

    it('⚠️ sends no markup of any kind to the requester', () => {
      for (const rendered of [html(PASTED), text(PASTED)]) {
        expect(rendered).not.toContain('data-attachment-id');
        expect(rendered).not.toContain('data-temp-id');
        expect(rendered).not.toContain('<img');
        // The old HTML half escaped the tag rather than dropping it, which is
        // how the markup was visible in a client that renders HTML.
        expect(rendered).not.toContain('&lt;img');
      }
    });

    it('keeps the words that were around the image, and names the image', () => {
      expect(html(PASTED)).toContain('see the img');
      expect(text(PASTED)).toContain('see the img');
      // Not a silent gap: a sentence reading "the error looks like this:" needs
      // something after the colon.
      expect(html(PASTED)).toContain('[image: image.png]');
      expect(text(PASTED)).toContain('[image: image.png]');
    });

    it('⚠️ keeps the inbox preview clean too', () => {
      // The preheader is built from the earliest text in the body, so the
      // markup was in the inbox LIST, before anyone opened anything.
      const line = html(PASTED)
        .split(/\r?\n/)
        .find((row) => row.includes('mso-hide:all')) as string;
      expect(line).not.toContain('data-attachment-id');
      expect(line).not.toContain('data-temp-id');
      expect(line).not.toContain('&lt;img');
      // ⚠️ CARD 1.136: AND NOT THE PICTURE EITHER. Card 1.129 left the
      // placeholder standing here, so the owner's inbox list read
      // `[image: image.png]Are you still getting this...` - the preview spent
      // its opening characters, the only ones anybody reads, on a filename
      // that is almost always `image.png`. Right in the text PART, which is
      // the whole message for a client that will not render HTML; wrong in a
      // one-line preview.
      expect(line).not.toContain('[image:');
      expect(line).toContain('see the img');
    });

    it('⚠️ but an image-only message keeps its name in the preview', () => {
      // Strip the picture from a message that is nothing but a picture and the
      // preheader is empty, at which point the client previews whatever text
      // it finds next - our own hidden layout. A filename beats that.
      const imageOnly =
        '<img alt="scan.png" data-attachment-id="324e680b-1111-4222-8333-444455556666">';
      const line = html(imageOnly)
        .split(/\r?\n/)
        .find((row) => row.includes('mso-hide:all')) as string;
      expect(line).toContain('[image: scan.png]');
    });

    it('⚠️ the text part puts the picture on its own line', () => {
      // `<img>` is inline, so the straight swap welded the name to the next
      // word: `[image: image.png]see the img`. The HTML half draws the same
      // picture as display:block; the two should not disagree.
      expect(text(PASTED)).toContain('[image: image.png]\nsee the img');
    });

    it("an agent's formatting arrives as formatting, not as tags", () => {
      // ⚠️ THIS IS WIDER THAN THE PASTED IMAGE. Every multi-line or formatted
      // reply was escaped, so bold, lists and links all reached the requester
      // as visible markup. The image is only the case somebody screenshotted.
      const formatted =
        '<p>Hi Dana,</p><p>The punch is <strong>missing</strong>.</p>';
      const rendered = html(formatted);
      expect(rendered).toContain('<strong>missing</strong>');
      expect(rendered).not.toContain('&lt;strong&gt;');
      expect(text(formatted)).toContain('The punch is missing.');
      expect(text(formatted)).not.toContain('<p>');
    });

    it('⚠️ is default-deny: a script inside a formatted body goes with its contents', () => {
      // The body is not trusted markup - anything holding a token can POST one.
      const hostile = '<p>hello</p><script>alert("x")</script>';
      const rendered = html(hostile);
      expect(rendered).toContain('<p>hello</p>');
      expect(rendered).not.toContain('<script');
      expect(rendered).not.toContain('alert');
    });

    it('⚠️ drops a javascript: link and every event attribute', () => {
      const hostile =
        '<p onclick="steal()"><a href="javascript:alert(1)">click</a></p>';
      const rendered = html(hostile);
      expect(rendered).not.toContain('javascript:');
      expect(rendered).not.toContain('onclick');
      expect(rendered).not.toContain('steal');
      // The words survive; only the trap is removed.
      expect(rendered).toContain('click');
    });

    it('keeps a real link, with the attributes a mail client needs', () => {
      const withLink =
        '<p>See <a href="https://tickets.csnhc.com/t/1" title="x">the ticket</a>.</p>';
      const rendered = html(withLink);
      expect(rendered).toContain('href="https://tickets.csnhc.com/t/1"');
      expect(rendered).toContain('rel="noopener noreferrer"');
      // Every other attribute is dropped, including ones that look harmless.
      expect(rendered).not.toContain('title=');
    });
  });

  describe('card 1.130 - the image actually travels', () => {
    const ID = '324e680b-1111-4222-8333-444455556666';
    const PASTED = `<img alt="screenshot.png" data-attachment-id="${ID}">see the img`;
    const CARRIED = [{ attachmentId: ID, cid: `${ID}@csnhc.com` }];

    it('⚠️ draws the image when its bytes are travelling with the email', () => {
      // THE ASSERTION THIS CARD EXISTS FOR. `cid:` and not a URL: a link to
      // /api/attachments/:id sits behind Easy Auth and the app's own guard, and
      // most clients block remote images anyway.
      const rendered = html(PASTED, ACTOR, CARRIED);

      expect(rendered).toContain(`<img src="cid:${ID}@csnhc.com"`);
      expect(rendered).toContain('alt="screenshot.png"');
      expect(rendered).toContain('max-width:100%');
      // Card 1.129's guarantees still hold: no internal marker reaches anybody.
      expect(rendered).not.toContain('data-attachment-id');
      expect(rendered).not.toContain('data-temp-id');
      expect(rendered).toContain('see the img');
    });

    it('⚠️ names it instead when the bytes are NOT travelling', () => {
      // NON-VACUITY, and the normal path for anything the email declined to
      // carry: a file on an internal note, one over the ceiling, one the AV
      // gate refuses, one that could not be read. Card 1.129's behaviour.
      const rendered = html(PASTED);

      expect(rendered).not.toContain('cid:');
      expect(rendered).toContain('[image: screenshot.png]');
    });

    it('names it when a DIFFERENT attachment is the one travelling', () => {
      // The map is keyed by attachment id, so an unrelated image on the same
      // email cannot lend this one a cid.
      const rendered = html(PASTED, ACTOR, [
        { attachmentId: 'some-other-file', cid: 'other@csnhc.com' },
      ]);

      expect(rendered).not.toContain('cid:');
      expect(rendered).toContain('[image: screenshot.png]');
    });

    it('⚠️ the TEXT half still names it, because text cannot show a picture', () => {
      expect(text(PASTED)).toContain('[image: screenshot.png]');
      expect(text(PASTED)).not.toContain('cid:');
      expect(text(PASTED)).not.toContain('<img');
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
