import {
  REPLY_ABOVE_MARKER,
  stripQuotedReply,
} from './quoted-reply.util';

describe('stripQuotedReply', () => {
  it('cuts an Outlook From/Sent/To/Subject block', () => {
    const body = [
      'That worked, thanks.',
      '',
      'From: CSNHC Helpdesk <helpdesk@csnhc.com>',
      'Sent: Monday, 1 September 2026 11:42',
      'To: Sarah Chen <sarah.chen@csnhc.com>',
      'Subject: [Ticket IS_20260901_001] Printer down',
      '',
      'We have an update on your request.',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('That worked, thanks.');
  });

  it('cuts a Gmail attribution line', () => {
    const body = [
      'Still broken I am afraid.',
      '',
      'On Mon, 1 Sep 2026 at 11:42, Sarah Chen <sarah.chen@csnhc.com> wrote:',
      '> Have you tried turning it off and on again?',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Still broken I am afraid.');
  });

  it('cuts a Gmail attribution that wrapped onto a second line', () => {
    const body = [
      'Confirmed fixed.',
      '',
      'On Mon, 1 Sep 2026 at 11:42, Sarah Chen from the Service Desk',
      '<sarah.chen@csnhc.com> wrote:',
      '> Please confirm.',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Confirmed fixed.');
  });

  it('cuts -----Original Message-----', () => {
    const body = [
      'Approved.',
      '',
      '-----Original Message-----',
      'From: someone',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Approved.');
  });

  it('cuts at our own reply-above marker', () => {
    const body = [
      'Yes please go ahead.',
      '',
      REPLY_ABOVE_MARKER,
      '',
      'Hello Sarah,',
      'We have an update on your request.',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Yes please go ahead.');
  });

  it('⚠️ leaves an underscore rule alone (card 1.66 removed that marker)', () => {
    // INVERTED, not deleted, so the old behaviour stays on the record.
    //
    // ⚠️ AND THIS FIXTURE IS ITSELF THE ARGUMENT FOR THE CHANGE. It looks
    // like an email - it has a `From:` line - but marker 3 requires `Sent:` or
    // `Date:` on the line immediately after, and there is none. So with the
    // underscore marker gone this body carries NO email signal at all, and the
    // trimmer correctly declines to cut it. A body that ambiguous is far more
    // likely to be an agent's note with a divider in it than a quoted reply.
    const body = ['Done.', '', '________________________________', 'From: x'].join('\n');
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('⚠️ leaves an RFC signature delimiter alone (card 1.66)', () => {
    // The signature now stays. Showing an agent four extra lines of somebody's
    // sign-off is a far smaller harm than silently eating the second half of a
    // note they typed, and the util's own doc comment already said it does not
    // guess at signature blocks.
    const body = ['Thanks for the help.', '', '-- ', 'Sarah Chen', 'Service Desk'].join('\n');
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('⚠️ returns an agent note containing a divider byte-identical', () => {
    // THE ASSERTION THAT FAILS IF EITHER MARKER COMES BACK. This is the defect
    // card 1.62 introduced: an internal note is written in the app, never
    // travels through a mail client, and carries no email artefacts - so every
    // one of the remaining markers correctly declines it. Both removed markers
    // would have cut it, and the agent would have lost everything below their
    // own divider with no indication anything was missing.
    const note = [
      'Checked with the vendor.',
      '',
      '________________________________',
      '',
      'Next steps:',
      '-- ',
      'ring them back Thursday if no reply',
    ].join('\n');
    expect(stripQuotedReply(note)).toBe(note);
  });

  it('returns a body with no marker byte-identical', () => {
    const body =
      'Line one.\r\n\r\nLine two with -- dashes inline and a From: mention.\r\n   trailing spaces   ';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('does not treat a horizontal rule of many dashes as a signature', () => {
    const body = ['Notes below.', '----------', 'Still my own words.'].join('\n');
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('returns the original when the body is nothing but a quote', () => {
    const body = [
      'On Mon, 1 Sep 2026 at 11:42, Sarah Chen <sarah.chen@csnhc.com> wrote:',
      '> the whole thing is quoted',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('keeps everything above the earliest marker when several appear', () => {
    const body = [
      'Short answer: yes.',
      '',
      'On Mon, 1 Sep 2026 at 11:42, Sarah Chen <sarah.chen@csnhc.com> wrote:',
      '> -----Original Message-----',
      '> From: someone',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('Short answer: yes.');
  });

  it('passes an empty body straight through', () => {
    expect(stripQuotedReply('')).toBe('');
  });
});
