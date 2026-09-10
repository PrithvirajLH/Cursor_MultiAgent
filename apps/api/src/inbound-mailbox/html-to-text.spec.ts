import { readFileSync } from 'fs';
import { join } from 'path';
import { htmlToText } from './html-to-text.util';
import { stripQuotedReply } from '../notifications/quoted-reply.util';

/**
 * The real message that produced card 1.62, straight out of production.
 *
 * ⚠️ Two phone numbers in the signature were replaced with `000-000-0000`,
 * same length so the document is byte-identical in size and shape. This repo
 * has public remotes and the numbers contribute nothing to the test; the
 * email addresses are kept because one of them is asserted on - the quoted
 * `&lt;glovebox@csnhc.com&gt;` is what proves entities are decoded after tags
 * are stripped rather than before.
 */
const REAL_OUTLOOK_REPLY = readFileSync(
  join(__dirname, '__fixtures__', 'outlook-reply.html'),
  'utf8',
);

/**
 * Card 1.62 — an inbound email showed its HTML source.
 *
 * The fixture is the actual first reply card 1.24's worker ingested
 * (`NA_20260910_357`), pulled read-only from production. It carries five noise
 * sources at once - an Outlook document wrapper, a `<style>` block, a
 * signature, our own quoted outbound email and the pilot-mode notice - which
 * no hand-written fixture would have got right.
 */
describe('htmlToText (card 1.62)', () => {
  describe('the real message', () => {
    it('⚠️ turns 5,325 characters of markup into the sentence somebody typed', () => {
      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. The agent saw the
      // whole document as literal text; the human content was ~0.6% of it.
      const text = htmlToText(REAL_OUTLOOK_REPLY);
      expect(REAL_OUTLOOK_REPLY.length).toBe(5325);
      expect(text).toContain('Ticket acknowledgement received.');
      expect(text.length).toBeLessThan(REAL_OUTLOOK_REPLY.length / 3);
    });

    it('⚠️ leaves no tags, no style block and no meta', () => {
      const text = htmlToText(REAL_OUTLOOK_REPLY);
      // Real markup, not merely angle brackets. The output legitimately still
      // contains `<glovebox@csnhc.com>`: the sender's client quoted that
      // address as `&lt;…&gt;`, and entities are decoded AFTER tags are
      // stripped, so it can never be mistaken for a tag. It is content.
      expect(text).not.toMatch(
        /<\/?(?:html|head|body|div|p|span|style|meta|br|table|font)\b/i,
      );
      expect(text).toContain('<glovebox@csnhc.com>');
      expect(text).not.toContain('font-family');
      expect(text).not.toContain('Content-Type');
      expect(text).not.toContain('margin-bottom');
      expect(text).not.toContain('&nbsp;');
    });

    it('⚠️ puts our reply marker on a line of its own, so the trimmer can see it', () => {
      // THE LINE THAT MAKES FAULT B'S FIX MEAN ANYTHING. In the raw body the
      // marker is `<p>----- Reply above this line -----</p>`, and every quote
      // marker is `^...$` with the `m` flag - so before this conversion the
      // trimmer matched nothing at all and wiring it would have been a commit
      // that looked like a fix.
      const text = htmlToText(REAL_OUTLOOK_REPLY);
      expect(text).toMatch(/^----- Reply above this line -----$/m);
    });

    it('⚠️ together with the trimmer, the agent sees the sentence and nothing else', () => {
      const shown = stripQuotedReply(htmlToText(REAL_OUTLOOK_REPLY));
      expect(shown).toContain('Ticket acknowledgement received.');
      // Everything below our marker is gone: our own email, quoted back...
      expect(shown).not.toContain('Reply above this line');
      expect(shown).not.toContain('We have your email');
      // ...and the pilot-mode notice that came back with it.
      expect(shown).not.toContain('pilot mode');
      expect(shown).not.toContain('EMAIL_TEST_RECIPIENTS');
      // 5,325 characters down to under 300.
      expect(shown.length).toBeLessThan(300);
    });
  });

  describe('conversion rules', () => {
    it('⚠️ strips per-line indentation, which is WHY it must only see HTML', () => {
      // NOT an identity function. Outlook indents its markup and that indent
      // belongs to the document, not the sender - but text somebody
      // deliberately indented would be flattened too. That is exactly why
      // `selectBodyText` calls this only when contentType says html, and why
      // the byte-for-byte guarantee for text/plain is asserted over there.
      expect(htmlToText('Line one.\n\n  indented line')).toBe(
        'Line one.\n\nindented line',
      );
    });

    it('turns block boundaries into newlines', () => {
      // A block break is a blank line - its close and the next open each
      // contribute a newline - while a <br> is a single newline. That is what
      // makes the real message read correctly: one blank line after the
      // sentence, then the signature single-spaced.
      expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
      expect(htmlToText('<div>One</div><div>Two</div>')).toBe('One\n\nTwo');
      expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('a\n\nb');
      expect(htmlToText('One<br>Two<br/>Three')).toBe('One\nTwo\nThree');
    });

    it('drops script, style and head with their contents', () => {
      expect(htmlToText('<style>p{color:red}</style>Hello')).toBe('Hello');
      expect(htmlToText('<script>alert(1)</script>Hello')).toBe('Hello');
      expect(
        htmlToText('<html><head><meta charset="utf-8"></head><body>Hi</body></html>'),
      ).toBe('Hi');
    });

    it('decodes entities, and does not decode twice', () => {
      expect(htmlToText('a&nbsp;b')).toBe('a b');
      expect(htmlToText('&lt;tag&gt;')).toBe('<tag>');
      expect(htmlToText('Tom &amp; Jerry')).toBe('Tom & Jerry');
      expect(htmlToText('&#39;quoted&#39;')).toBe("'quoted'");
      expect(htmlToText('&#x27;hex&#x27;')).toBe("'hex'");
      // ⚠️ The double-decode trap: this is a sender writing the LITERAL text
      // "&lt;", not markup. Decoding &amp; first would invent a tag.
      expect(htmlToText('&amp;lt;')).toBe('&lt;');
    });

    it('collapses runaway blank lines but keeps a paragraph break', () => {
      expect(htmlToText('<p>a</p><p></p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
      expect(htmlToText('a\n\nb')).toBe('a\n\nb');
    });

    it('passes empty and falsy input straight through', () => {
      expect(htmlToText('')).toBe('');
      expect(htmlToText(null as unknown as string)).toBeNull();
    });

    it('does not mistake a lone < for a tag', () => {
      expect(htmlToText('5 < 7 and 9 > 2')).toBe('5 < 7 and 9 > 2');
    });
  });
});
