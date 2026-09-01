import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { REPLY_ABOVE_MARKER } from './quoted-reply.util';

const sendMail = jest.fn().mockResolvedValue({ messageId: 'sent' });

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail })) },
}));

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
  return new EmailService(config);
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
      new EmailService(config).sendEmail({
        to: 'sarah.chen@csnhc.com',
        subject: 'Ticket update',
        text: 'Hello',
      }),
    ).rejects.toThrow('SMTP not configured');
  });
});
