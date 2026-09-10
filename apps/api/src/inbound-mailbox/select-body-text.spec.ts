import { selectBodyText } from './select-body-text.util';

/**
 * Card 1.62, fault A — `contentType` was in scope and never read.
 */
describe('selectBodyText (card 1.62)', () => {
  it('⚠️ flattens an HTML body', () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. `body.content` was
    // taken verbatim whatever `contentType` said, so an Outlook message
    // reached the agent as a complete HTML document.
    const result = selectBodyText(
      { contentType: 'html', content: '<p>Hello there.</p>' },
      'Hello there.',
    );
    expect(result).toBe('Hello there.');
  });

  it('⚠️ leaves a text/plain body byte for byte unchanged', () => {
    // The other half, and the one most easily lost: `htmlToText` strips
    // per-line indentation, so text that was never HTML must not go through
    // it. Indentation, blank lines and trailing content all survive exactly.
    const plain = 'Line one.\n\n  indented on purpose\nLine three.  ';
    expect(selectBodyText({ contentType: 'text', content: plain }, 'x')).toBe(
      plain,
    );
  });

  it('treats an unknown or missing contentType as text, not HTML', () => {
    // Conservative on purpose: flattening something that was already text
    // silently edits it, while leaving markup alone is visible and reported.
    const value = '  keep   me  ';
    expect(selectBodyText({ content: value }, '')).toBe(value);
    expect(selectBodyText({ contentType: 'weird', content: value }, '')).toBe(
      value,
    );
  });

  it('is not case-sensitive about contentType', () => {
    expect(selectBodyText({ contentType: 'HTML', content: '<p>a</p>' }, '')).toBe(
      'a',
    );
  });

  it('⚠️ falls back to the preview only when there is no content', () => {
    // The one thing card 1.24's ternary genuinely did, kept deliberately:
    // Graph returns bodyPreview already flattened, so it is a useful last
    // resort. Everything else about that expression was decorative.
    expect(selectBodyText({ contentType: 'html', content: '' }, 'preview')).toBe(
      'preview',
    );
    expect(selectBodyText(undefined, 'preview')).toBe('preview');
    // ...and never when there IS content.
    expect(
      selectBodyText({ contentType: 'text', content: 'real' }, 'preview'),
    ).toBe('real');
  });

  it('returns an empty string when there is neither', () => {
    expect(selectBodyText(undefined, undefined)).toBe('');
    expect(selectBodyText({}, null)).toBe('');
  });
});
