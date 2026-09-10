import {
  classifyInboundAddress,
  RecipientCandidate,
} from './classify-inbound-address.util';

const MAILBOX = 'helpdesk@csnhc.com';

const to = (address: string): RecipientCandidate => ({ address, source: 'to' });
const cc = (address: string): RecipientCandidate => ({ address, source: 'cc' });
const deliveredTo = (address: string): RecipientCandidate => ({
  address,
  source: 'delivered-to',
});

/**
 * Card 1.24 — one mailbox, two kinds of plus-suffix.
 *
 * The owner's rule (2026-09-01): a suffix beginning `ticket-` is a reply
 * token, anything else is a department slug.
 */
describe('classifyInboundAddress (card 1.24)', () => {
  describe('telling the two suffixes apart', () => {
    it('routes +ticket-<token> to that ticket', () => {
      const result = classifyInboundAddress(
        [to('helpdesk+ticket-a1b2c3d4e5f6a7b8@csnhc.com')],
        MAILBOX,
      );
      expect(result).toEqual({
        kind: 'reply',
        token: 'a1b2c3d4e5f6a7b8',
        matchedAddress: 'helpdesk+ticket-a1b2c3d4e5f6a7b8@csnhc.com',
      });
    });

    it('routes +payroll to the Payroll department', () => {
      const result = classifyInboundAddress([to('helpdesk+payroll@csnhc.com')], MAILBOX);
      expect(result).toMatchObject({ kind: 'department', slug: 'payroll' });
    });

    it('resolves +it through the alias map', () => {
      // Nobody will type helpdesk+it-service-desk@csnhc.com.
      const result = classifyInboundAddress([to('helpdesk+it@csnhc.com')], MAILBOX);
      expect(result).toMatchObject({ kind: 'department', slug: 'it-service-desk' });
    });

    it('treats the bare address as neither', () => {
      const result = classifyInboundAddress([to('helpdesk@csnhc.com')], MAILBOX);
      expect(result).toMatchObject({ kind: 'bare' });
    });

    it('⚠️ a reply token WINS over a department suffix on the same message', () => {
      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. A reply-all to our
      // acknowledgement carries the original `+payroll` in To AND our
      // `+ticket-` Reply-To in Cc. Routing on the department would open a
      // SECOND ticket for a conversation that already has one - the duplicate
      // card 1.43 exists to prevent. Department addressing is first-message
      // only.
      const result = classifyInboundAddress(
        [
          to('helpdesk+payroll@csnhc.com'),
          cc('helpdesk+ticket-a1b2c3d4e5f6a7b8@csnhc.com'),
        ],
        MAILBOX,
      );
      expect(result).toMatchObject({ kind: 'reply', token: 'a1b2c3d4e5f6a7b8' });
    });
  });

  describe('where the address is found', () => {
    it('⚠️ finds it in CC when To is somebody else', () => {
      // THE REGRESSION ASSERTION, HALF ONE. On a reply-all the human is in To
      // and we are in Cc. Parsing only To drops exactly the loop-in case card
      // 1.40 exists to fix.
      const result = classifyInboundAddress(
        [to('manager@csnhc.com'), cc('helpdesk+ticket-a1b2c3d4e5f6a7b8@csnhc.com')],
        MAILBOX,
      );
      expect(result).toMatchObject({ kind: 'reply', token: 'a1b2c3d4e5f6a7b8' });
    });

    it('⚠️ finds it in Delivered-To when it is in neither To nor CC', () => {
      // THE REGRESSION ASSERTION, HALF TWO. A forwarding rule rewrote the
      // envelope, so Delivered-To is the only witness that we were addressed.
      // Kept as a SEPARATE test from the Cc one on purpose: they fail for
      // different reasons and a single combined case would hide one of them.
      const result = classifyInboundAddress(
        [
          to('manager@csnhc.com'),
          cc('someone.else@csnhc.com'),
          deliveredTo('helpdesk+payroll@csnhc.com'),
        ],
        MAILBOX,
      );
      expect(result).toMatchObject({ kind: 'department', slug: 'payroll' });
    });

    it('returns none when we are not addressed at all', () => {
      const result = classifyInboundAddress(
        [to('manager@csnhc.com'), cc('someone.else@csnhc.com')],
        MAILBOX,
      );
      expect(result).toEqual({ kind: 'none' });
    });

    it('does not match a different mailbox on our domain', () => {
      // `payroll@csnhc.com` is not `helpdesk@csnhc.com` with a suffix.
      const result = classifyInboundAddress([to('payroll@csnhc.com')], MAILBOX);
      expect(result).toEqual({ kind: 'none' });
    });

    it('does not match our local part on somebody else"s domain', () => {
      const result = classifyInboundAddress(
        [to('helpdesk+payroll@example.com')],
        MAILBOX,
      );
      expect(result).toEqual({ kind: 'none' });
    });
  });

  describe('shapes that turn up in real mail', () => {
    it('accepts a display-name form', () => {
      const result = classifyInboundAddress(
        [to('CSNHC Helpdesk <helpdesk+payroll@csnhc.com>')],
        MAILBOX,
      );
      expect(result).toMatchObject({ kind: 'department', slug: 'payroll' });
    });

    it('is case-insensitive', () => {
      const result = classifyInboundAddress(
        [to('HelpDesk+TICKET-A1B2C3D4E5F6A7B8@CSNHC.COM')],
        'HELPDESK@csnhc.com',
      );
      expect(result).toMatchObject({
        kind: 'reply',
        token: 'a1b2c3d4e5f6a7b8',
      });
    });

    it('⚠️ an unknown suffix does NOT silently become a real department', () => {
      // It comes back as a department candidate carrying the suffix verbatim.
      // The worker then fails to resolve it and ingests the mail UNROUTED -
      // it must never fall through to whichever team sorts first.
      const result = classifyInboundAddress(
        [to('helpdesk+nosuchteam@csnhc.com')],
        MAILBOX,
      );
      expect(result).toMatchObject({ kind: 'department', slug: 'nosuchteam' });
    });

    it('a bare "ticket-" with no token is unusable rather than a reply', () => {
      const result = classifyInboundAddress(
        [to('helpdesk+ticket-@csnhc.com')],
        MAILBOX,
      );
      expect(result).toMatchObject({ kind: 'unknown', suffix: 'ticket-' });
    });

    it('ignores junk that is not an address', () => {
      const result = classifyInboundAddress(
        [to('not-an-address'), to('@nolocal.com'), to('trailing@')],
        MAILBOX,
      );
      expect(result).toEqual({ kind: 'none' });
    });

    it('returns none when the configured mailbox is itself unusable', () => {
      expect(classifyInboundAddress([to('helpdesk@csnhc.com')], '')).toEqual({
        kind: 'none',
      });
    });
  });
});
