import { MessageType } from '@prisma/client';
import { resolveOutboundRecipients } from './outbound-recipients.util';

const DOMAINS = 'csnhc.com';

describe('resolveOutboundRecipients', () => {
  it('allows an address inside the allowed domain', () => {
    const result = resolveOutboundRecipients({
      recipients: [{ address: 'sarah.chen@csnhc.com' }],
      allowedDomains: DOMAINS,
    });
    expect(result.allowed).toEqual(['sarah.chen@csnhc.com']);
    expect(result.refused).toEqual([]);
  });

  it('refuses an address outside the allowed domain, and says so', () => {
    const result = resolveOutboundRecipients({
      recipients: [
        { address: 'sarah.chen@csnhc.com' },
        { address: 'someone@gmail.com' },
      ],
      allowedDomains: DOMAINS,
    });
    expect(result.allowed).toEqual(['sarah.chen@csnhc.com']);
    expect(result.refused).toEqual([
      { address: 'someone@gmail.com', reason: 'outside the allowed domains' },
    ]);
  });

  it('reads the domain list from the environment when none is passed', () => {
    const previous = process.env.EMAIL_ALLOWED_DOMAINS;
    process.env.EMAIL_ALLOWED_DOMAINS = 'csnhc.com, partner.example';
    try {
      const result = resolveOutboundRecipients({
        recipients: [{ address: 'someone@partner.example' }],
      });
      expect(result.allowed).toEqual(['someone@partner.example']);
    } finally {
      if (previous === undefined) delete process.env.EMAIL_ALLOWED_DOMAINS;
      else process.env.EMAIL_ALLOWED_DOMAINS = previous;
    }
  });

  it('defaults to csnhc.com when the variable is unset', () => {
    const previous = process.env.EMAIL_ALLOWED_DOMAINS;
    delete process.env.EMAIL_ALLOWED_DOMAINS;
    try {
      const result = resolveOutboundRecipients({
        recipients: [{ address: 'a@csnhc.com' }, { address: 'b@elsewhere.com' }],
      });
      expect(result.allowed).toEqual(['a@csnhc.com']);
      expect(result.refused).toHaveLength(1);
    } finally {
      if (previous !== undefined) process.env.EMAIL_ALLOWED_DOMAINS = previous;
    }
  });

  it('never replies to a no-reply style address', () => {
    const result = resolveOutboundRecipients({
      recipients: [
        { address: 'no-reply@csnhc.com' },
        { address: 'NoReply@csnhc.com' },
        { address: 'donotreply@csnhc.com' },
        { address: 'mailer-daemon@csnhc.com' },
        { address: 'postmaster@csnhc.com' },
      ],
      allowedDomains: DOMAINS,
    });
    expect(result.allowed).toEqual([]);
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      'no-reply address',
      'no-reply address',
      'no-reply address',
      'no-reply address',
      'no-reply address',
    ]);
  });

  it('refuses an address that has bounced', () => {
    const result = resolveOutboundRecipients({
      recipients: [{ address: 'gone@csnhc.com' }],
      allowedDomains: DOMAINS,
      suppressed: ['GONE@csnhc.com'],
    });
    expect(result.allowed).toEqual([]);
    expect(result.refused).toEqual([
      { address: 'gone@csnhc.com', reason: 'suppressed after a bounce' },
    ]);
  });

  it('refuses something that is not an address at all', () => {
    const result = resolveOutboundRecipients({
      recipients: [{ address: 'not-an-address' }, { address: 'trailing@' }],
      allowedDomains: DOMAINS,
    });
    expect(result.allowed).toEqual([]);
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      'not a valid email address',
      'not a valid email address',
    ]);
  });

  it('de-duplicates case-insensitively', () => {
    const result = resolveOutboundRecipients({
      recipients: [
        { address: 'sarah.chen@csnhc.com' },
        { address: 'Sarah.Chen@csnhc.com' },
      ],
      allowedDomains: DOMAINS,
    });
    expect(result.allowed).toEqual(['sarah.chen@csnhc.com']);
  });

  it('THROWS when an internal note is addressed to the requester', () => {
    expect(() =>
      resolveOutboundRecipients({
        messageType: MessageType.INTERNAL,
        recipients: [
          { address: 'agent@csnhc.com' },
          { address: 'sarah.chen@csnhc.com', isRequester: true },
        ],
        allowedDomains: DOMAINS,
      }),
    ).toThrow(/INTERNAL note cannot be addressed to the requester/);
  });

  it('names the error so a future caller cannot mistake it for a validation failure', () => {
    let caught: Error | null = null;
    try {
      resolveOutboundRecipients({
        messageType: MessageType.INTERNAL,
        recipients: [{ address: 'sarah.chen@csnhc.com', isRequester: true }],
        allowedDomains: DOMAINS,
      });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.name).toBe('InternalNoteRecipientError');
  });

  it('refuses the requester even when the requester is staff', () => {
    // The live bug this closes: NotificationsService drops EMPLOYEEs from an
    // internal note, which does nothing when the requester is an agent.
    expect(() =>
      resolveOutboundRecipients({
        messageType: MessageType.INTERNAL,
        recipients: [{ address: 'agent.who.raised.it@csnhc.com', isRequester: true }],
        allowedDomains: DOMAINS,
      }),
    ).toThrow(/INTERNAL/);
  });

  it('lets an internal note reach staff who are not the requester', () => {
    const result = resolveOutboundRecipients({
      messageType: MessageType.INTERNAL,
      recipients: [{ address: 'lead@csnhc.com' }, { address: 'agent@csnhc.com' }],
      allowedDomains: DOMAINS,
    });
    expect(result.allowed).toEqual(['lead@csnhc.com', 'agent@csnhc.com']);
  });

  it('leaves a public message to the requester alone', () => {
    const result = resolveOutboundRecipients({
      messageType: MessageType.PUBLIC,
      recipients: [{ address: 'sarah.chen@csnhc.com', isRequester: true }],
      allowedDomains: DOMAINS,
    });
    expect(result.allowed).toEqual(['sarah.chen@csnhc.com']);
  });
});
