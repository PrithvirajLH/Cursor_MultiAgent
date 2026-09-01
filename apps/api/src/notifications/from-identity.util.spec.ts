import { buildFromIdentity } from './from-identity.util';

const ADDRESS = 'helpdesk@csnhc.com';

describe('buildFromIdentity', () => {
  it('names the agent alongside the helpdesk', () => {
    expect(buildFromIdentity({ agentDisplayName: 'Sarah Chen', address: ADDRESS })).toBe(
      '"Sarah Chen (CSNHC Helpdesk)" <helpdesk@csnhc.com>',
    );
  });

  it('falls back to the generic identity when no agent is named', () => {
    expect(buildFromIdentity({ address: ADDRESS })).toBe(
      'CSNHC Helpdesk <helpdesk@csnhc.com>',
    );
    expect(buildFromIdentity({ agentDisplayName: '   ', address: ADDRESS })).toBe(
      'CSNHC Helpdesk <helpdesk@csnhc.com>',
    );
    expect(buildFromIdentity({ agentDisplayName: null, address: ADDRESS })).toBe(
      'CSNHC Helpdesk <helpdesk@csnhc.com>',
    );
  });

  it('quotes a display name containing a comma rather than concatenating it raw', () => {
    const from = buildFromIdentity({ agentDisplayName: 'Chen, Sarah', address: ADDRESS });
    expect(from).toBe('"Chen, Sarah (CSNHC Helpdesk)" <helpdesk@csnhc.com>');
    // The comma must not be able to read as a second recipient.
    expect(from.startsWith('"')).toBe(true);
  });

  it('escapes a quote inside a display name', () => {
    expect(
      buildFromIdentity({ agentDisplayName: 'Sarah "Sam" Chen', address: ADDRESS }),
    ).toBe('"Sarah \\"Sam\\" Chen (CSNHC Helpdesk)" <helpdesk@csnhc.com>');
  });

  it('escapes a backslash inside a display name', () => {
    expect(
      buildFromIdentity({ agentDisplayName: 'Domain\\User', address: ADDRESS }),
    ).toBe('"Domain\\\\User (CSNHC Helpdesk)" <helpdesk@csnhc.com>');
  });

  it('takes the address from SMTP_FROM when none is passed', () => {
    const previous = process.env.SMTP_FROM;
    process.env.SMTP_FROM = 'tickets@csnhc.com';
    try {
      expect(buildFromIdentity({ agentDisplayName: 'Sarah Chen' })).toBe(
        '"Sarah Chen (CSNHC Helpdesk)" <tickets@csnhc.com>',
      );
    } finally {
      if (previous === undefined) delete process.env.SMTP_FROM;
      else process.env.SMTP_FROM = previous;
    }
  });

  it('still produces a usable From line with no configuration at all', () => {
    const previous = process.env.SMTP_FROM;
    delete process.env.SMTP_FROM;
    try {
      expect(buildFromIdentity()).toBe('CSNHC Helpdesk <helpdesk@csnhc.com>');
    } finally {
      if (previous !== undefined) process.env.SMTP_FROM = previous;
    }
  });
});
