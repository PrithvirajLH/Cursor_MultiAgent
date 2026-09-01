import { isAutomatedEmail } from './auto-reply.util';

describe('isAutomatedEmail', () => {
  it('treats a message with no headers at all as human', () => {
    expect(isAutomatedEmail({})).toBe(false);
  });

  it('treats Auto-Submitted: no as human, which is what RFC 3834 means by it', () => {
    expect(isAutomatedEmail({ autoSubmitted: 'no' })).toBe(false);
    expect(isAutomatedEmail({ autoSubmitted: '  NO  ' })).toBe(false);
  });

  it('treats any other Auto-Submitted value as automated', () => {
    expect(isAutomatedEmail({ autoSubmitted: 'auto-replied' })).toBe(true);
    expect(isAutomatedEmail({ autoSubmitted: 'auto-generated' })).toBe(true);
    expect(isAutomatedEmail({ autoSubmitted: 'something-new' })).toBe(true);
  });

  it('treats X-Auto-Response-Suppress as automated whatever it says', () => {
    expect(isAutomatedEmail({ autoResponseSuppress: 'OOF, AutoReply' })).toBe(true);
    expect(isAutomatedEmail({ autoResponseSuppress: 'All' })).toBe(true);
  });

  it('treats bulk, junk and list precedence as automated', () => {
    expect(isAutomatedEmail({ precedence: 'bulk' })).toBe(true);
    expect(isAutomatedEmail({ precedence: 'JUNK' })).toBe(true);
    expect(isAutomatedEmail({ precedence: 'list' })).toBe(true);
  });

  it('leaves an ordinary precedence alone', () => {
    expect(isAutomatedEmail({ precedence: 'normal' })).toBe(false);
  });

  it('treats a List-Id as automated', () => {
    expect(isAutomatedEmail({ listId: '<announce.csnhc.com>' })).toBe(true);
  });

  it('treats an empty Return-Path as automated but an absent one as human', () => {
    expect(isAutomatedEmail({ returnPath: '<>' })).toBe(true);
    expect(isAutomatedEmail({ returnPath: '' })).toBe(true);
    expect(isAutomatedEmail({ returnPath: '   ' })).toBe(true);
    expect(isAutomatedEmail({ returnPath: '<sarah.chen@csnhc.com>' })).toBe(false);
    expect(isAutomatedEmail({})).toBe(false);
  });

  it('ignores headers explicitly passed as null or blank', () => {
    expect(
      isAutomatedEmail({
        autoSubmitted: null,
        autoResponseSuppress: '   ',
        precedence: null,
        listId: '',
      }),
    ).toBe(false);
  });
});
