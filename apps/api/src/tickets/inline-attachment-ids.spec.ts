import { inlineAttachmentIds } from './inline-attachment-ids.util';

describe('inlineAttachmentIds', () => {
  it('finds the id an image was pasted in as', () => {
    expect(
      inlineAttachmentIds('<p>see this</p><img data-attachment-id="a1">'),
    ).toEqual(['a1']);
  });

  it('finds several, and never the same one twice', () => {
    const body =
      '<img data-attachment-id="a1"><img data-attachment-id="a2"><img data-attachment-id="a1">';
    expect(inlineAttachmentIds(body)).toEqual(['a1', 'a2']);
  });

  it('copes with single quotes and loose spacing', () => {
    expect(
      inlineAttachmentIds("<img data-attachment-id = 'a3' >"),
    ).toEqual(['a3']);
  });

  it('ignores an image that is still uploading', () => {
    // RichTextEditor inserts `<img data-temp-id>` first and only stamps the
    // attachment id when the upload resolves. Nothing to remove yet.
    expect(inlineAttachmentIds('<img data-temp-id="t1">')).toEqual([]);
  });

  it('returns nothing for a body with no images, or no body', () => {
    expect(inlineAttachmentIds('just words')).toEqual([]);
    expect(inlineAttachmentIds('')).toEqual([]);
    expect(inlineAttachmentIds(null)).toEqual([]);
    expect(inlineAttachmentIds(undefined)).toEqual([]);
  });

  it('skips an empty attribute rather than returning a blank id', () => {
    expect(inlineAttachmentIds('<img data-attachment-id="">')).toEqual([]);
  });
});
