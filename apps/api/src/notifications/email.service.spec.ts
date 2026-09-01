import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { EmailService } from './email.service';
import type { EmailSuppressionService } from './email-suppression.service';
import { REPLY_ABOVE_MARKER } from './quoted-reply.util';

const sendMail = jest.fn().mockResolvedValue({ messageId: 'sent', rejected: [] });

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail })) },
}));

const createTransport = nodemailer.createTransport as unknown as jest.Mock;
const isSuppressed = jest.fn().mockResolvedValue(false);
const recordFailure = jest.fn().mockResolvedValue(undefined);

function suppressionStub(): EmailSuppressionService {
  return { isSuppressed, recordFailure } as unknown as EmailSuppressionService;
}

const SMTP: Record<string, string> = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'user',
  SMTP_PASS: 'pass',
  SMTP_FROM: 'helpdesk@csnhc.com',
};

function buildService(): EmailService {
  const config = {
    get: (key: string) => SMTP[key],
  } as unknown as ConfigService;
  return new EmailService(config, suppressionStub());
}

function lastCall() {
  return sendMail.mock.calls[sendMail.mock.calls.length - 1][0] as {
    to: string[];
    text: string;
    html?: string;
  };
}

/** Every recipient the transport was ever handed, flattened. */
function everyRecipientEverSent(): string[] {
  return sendMail.mock.calls.flatMap(
    (call) => (call[0] as { to: string[] }).to,
  );
}

describe('EmailService', () => {
  const previousPilot = process.env.EMAIL_TEST_RECIPIENTS;

  beforeEach(() => {
    sendMail.mockClear();
    createTransport.mockClear();
    isSuppressed.mockClear().mockResolvedValue(false);
    recordFailure.mockClear().mockResolvedValue(undefined);
    sendMail.mockResolvedValue({ messageId: 'sent', rejected: [] });
    delete process.env.EMAIL_TEST_RECIPIENTS;
  });

  afterAll(() => {
    if (previousPilot === undefined) delete process.env.EMAIL_TEST_RECIPIENTS;
    else process.env.EMAIL_TEST_RECIPIENTS = previousPilot;
  });

  it('sends to the intended recipient when no pilot list is set', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    expect(lastCall().to).toEqual(['sarah.chen@csnhc.com']);
  });

  it('puts the reply-above marker at the top of the body', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
    const call = lastCall();
    expect(call.text.startsWith(REPLY_ABOVE_MARKER)).toBe(true);
    expect(call.text).toContain('Hello');
    expect(call.html?.startsWith(`<p>${REPLY_ABOVE_MARKER}</p>`)).toBe(true);
  });

  it('REPLACES the recipient list in pilot mode and names who it would have gone to', async () => {
    process.env.EMAIL_TEST_RECIPIENTS = 'operator@csnhc.com';
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    const call = lastCall();
    expect(call.to).toEqual(['operator@csnhc.com']);
    expect(call.to).not.toContain('sarah.chen@csnhc.com');
    expect(call.text).toContain('would otherwise have gone to: sarah.chen@csnhc.com');
  });

  it('never lets an intended recipient reach sendMail while the pilot list is set', async () => {
    // The invariant, pinned rather than described: a spread of inputs, none of
    // which may put an intended address on the wire.
    process.env.EMAIL_TEST_RECIPIENTS = 'operator@csnhc.com, second@csnhc.com';
    const service = buildService();
    const intendedAddresses = [
      'sarah.chen@csnhc.com',
      'AGENT@csnhc.com',
      'lead@csnhc.com, other@csnhc.com',
      '  spaced@csnhc.com  ',
    ];
    for (const to of intendedAddresses) {
      await service.sendEmail({ to, subject: 'Ticket update', text: 'Hello' });
    }
    const sent = everyRecipientEverSent().map((address) => address.toLowerCase());
    expect(sent.length).toBeGreaterThan(0);
    for (const address of sent) {
      expect(['operator@csnhc.com', 'second@csnhc.com']).toContain(address);
    }
  });

  it('refuses to send when every recipient is outside the allowed domains', async () => {
    await expect(
      buildService().sendEmail({
        to: 'someone@gmail.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow(/No allowed recipients/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('refuses to send to a no-reply address', async () => {
    await expect(
      buildService().sendEmail({
        to: 'no-reply@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow(/No allowed recipients/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('drops a refused address but still sends to the allowed ones', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com, outsider@gmail.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    expect(lastCall().to).toEqual(['sarah.chen@csnhc.com']);
  });

  it('still refuses everything when SMTP is not configured', async () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    await expect(
      new EmailService(config, suppressionStub()).sendEmail({
        to: 'sarah.chen@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('SMTP not configured');
  });
  it('requires STARTTLS when the connection is not implicitly secure', () => {
    buildService();
    const options = createTransport.mock.calls[0][0] as {
      secure: boolean;
      requireTLS: boolean;
      port: number;
    };
    // Port 587 with secure:false is STARTTLS. Without requireTLS nodemailer
    // silently falls back to plaintext and the SMTP password crosses the wire.
    expect(options.secure).toBe(false);
    expect(options.port).toBe(587);
    expect(options.requireTLS).toBe(true);
  });

  it('does not force STARTTLS when the port is already implicitly secure', () => {
    const config = {
      get: (key: string) => (key === 'SMTP_SECURE' ? 'true' : SMTP[key]),
    } as unknown as ConfigService;
    new EmailService(config, suppressionStub());
    const options = createTransport.mock.calls[0][0] as {
      secure: boolean;
      requireTLS: boolean;
    };
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it('sends from the generic desk identity when no agent is named', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    const call = sendMail.mock.calls[0][0] as { from: string };
    expect(call.from).toBe('CSNHC Helpdesk <helpdesk@csnhc.com>');
  });

  it('names the agent in the From line when one is supplied', async () => {
    await buildService().sendEmail({
      to: 'sarah.chen@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
      fromDisplayName: 'Sarah Chen',
    });
    const call = sendMail.mock.calls[0][0] as { from: string };
    expect(call.from).toBe('"Sarah Chen (CSNHC Helpdesk)" <helpdesk@csnhc.com>');
  });

  it('refuses a suppressed address', async () => {
    isSuppressed.mockResolvedValue(true);
    await expect(
      buildService().sendEmail({
        to: 'bounced@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow(/No allowed recipients/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('records a HARD failure when the server rejects permanently', async () => {
    const error = Object.assign(new Error('550 5.1.1 no such mailbox'), {
      responseCode: 550,
    });
    sendMail.mockRejectedValue(error);
    await expect(
      buildService().sendEmail({
        to: 'gone@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('550 5.1.1 no such mailbox');
    expect(recordFailure).toHaveBeenCalledWith(
      'gone@csnhc.com',
      'HARD',
      '550 5.1.1 no such mailbox',
    );
  });

  it('records a SOFT failure when the server is merely busy', async () => {
    const error = Object.assign(new Error('452 4.2.2 mailbox full'), {
      responseCode: 452,
    });
    sendMail.mockRejectedValue(error);
    await expect(
      buildService().sendEmail({
        to: 'full@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('452 4.2.2 mailbox full');
    expect(recordFailure).toHaveBeenCalledWith(
      'full@csnhc.com',
      'SOFT',
      '452 4.2.2 mailbox full',
    );
  });

  it('treats an unreadable failure as SOFT rather than silencing an address', async () => {
    sendMail.mockRejectedValue(new Error('socket hang up'));
    await expect(
      buildService().sendEmail({
        to: 'someone@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('socket hang up');
    expect(recordFailure).toHaveBeenCalledWith(
      'someone@csnhc.com',
      'SOFT',
      'socket hang up',
    );
  });

  it('records a recipient the server rejected while accepting the message', async () => {
    sendMail.mockResolvedValue({
      messageId: 'sent',
      rejected: ['gone@csnhc.com'],
      response: '550 5.1.1 unknown recipient',
    });
    await buildService().sendEmail({
      to: 'gone@csnhc.com',
      subject: 'Ticket update',
      text: 'Hello',
    });
    expect(recordFailure).toHaveBeenCalledWith(
      'gone@csnhc.com',
      'HARD',
      '550 5.1.1 unknown recipient',
    );
  });
});
