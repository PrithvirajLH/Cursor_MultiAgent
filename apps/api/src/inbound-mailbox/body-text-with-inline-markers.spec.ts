import { buildBodyTextWithInlineMarkers } from './body-text-with-inline-markers.util';

/**
 * Card 1.129, fault B — a pasted screenshot loses its position.
 *
 * The owner pasted an image into a reply; it arrived as a file on the ticket
 * and the stored body had no trace of where it had been. `htmlToText` drops
 * `<img>` with every other tag, and the `src="cid:..."` that said *"the image
 * belongs here, between these two sentences"* goes with it.
 *
 * ⚠️ EVERY TEST HERE IS ALSO A TEST THAT NOTHING ELSE CHANGED. Returning null
 * means "keep the body card 1.62 already produced", and that is the answer for
 * every message except one that genuinely pasted an image the worker kept.
 */
describe('buildBodyTextWithInlineMarkers', () => {
  const KEPT = new Set(['abc123@outlook']);

  it('marks where a pasted image was, and keeps the words around it', () => {
    const html =
      '<html><body><p>The error looks like this:</p>' +
      '<p><img src="cid:abc123@outlook" alt="screenshot.png"></p>' +
      '<p>Can you fix it?</p></body></html>';

    const result = buildBodyTextWithInlineMarkers(html, KEPT);

    expect(result).toContain('The error looks like this:');
    expect(result).toContain('[[cid:abc123@outlook]]');
    expect(result).toContain('Can you fix it?');
    // The marker sits between the two sentences, which is the whole point.
    expect(result?.indexOf('[[cid:')).toBeGreaterThan(
      result?.indexOf('looks like this') as number,
    );
    expect(result?.indexOf('[[cid:')).toBeLessThan(
      result?.indexOf('Can you fix it') as number,
    );
    // And it is still TEXT: card 1.62's conversion still ran.
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('<img');
  });

  it('reads a single-quoted src, and an attribute order it did not choose', () => {
    const html =
      "<p>see<img alt='x' width='20' src='cid:abc123@outlook' /></p>";

    expect(buildBodyTextWithInlineMarkers(html, KEPT)).toContain(
      '[[cid:abc123@outlook]]',
    );
  });

  it('⚠️ changes nothing when no image was kept - every signature logo', () => {
    // A logo is discarded by `isSignatureImage` before it is ever downloaded,
    // so it has no contentId here. The body must come back exactly as card
    // 1.62 made it, which is what null asks the caller to do.
    const html = '<p>Regards,</p><img src="cid:logo@corp" alt="logo.png">';

    expect(buildBodyTextWithInlineMarkers(html, KEPT)).toBeNull();
    expect(buildBodyTextWithInlineMarkers(html, new Set())).toBeNull();
  });

  it('⚠️ changes nothing when Graph sent plain text', () => {
    expect(buildBodyTextWithInlineMarkers(null, KEPT)).toBeNull();
  });

  it('⚠️ changes nothing when the body has no image at all', () => {
    expect(
      buildBodyTextWithInlineMarkers('<p>Just a sentence.</p>', KEPT),
    ).toBeNull();
  });

  it('marks the kept image and silently drops the logo beside it', () => {
    // The realistic case: a pasted screenshot above, a signature logo below.
    const html =
      '<p>Here:</p><img src="cid:abc123@outlook" alt="paste.png">' +
      '<p>Regards</p><img src="cid:logo@corp" alt="logo.png">';

    const result = buildBodyTextWithInlineMarkers(html, KEPT);

    expect(result).toContain('[[cid:abc123@outlook]]');
    expect(result).not.toContain('logo@corp');
    expect(result).toContain('Regards');
  });
});
