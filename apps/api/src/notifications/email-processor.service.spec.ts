import { OutboxStatus } from '@prisma/client';
import { EmailService } from './email.service';
import { EmailProcessorService } from './email-processor.service';
import { OutboxService } from './outbox.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

type MockOutbox = Pick<
  OutboxService,
  'claimPending' | 'markFailed' | 'markSent'
> & {
  claimPending: jest.MockedFunction<OutboxService['claimPending']>;
  markFailed: jest.MockedFunction<OutboxService['markFailed']>;
  markSent: jest.MockedFunction<OutboxService['markSent']>;
};

type MockEmail = Pick<
  EmailService,
  'isConfigured' | 'sendEmail' | 'getReplyToAddress'
> & {
  isConfigured: jest.MockedFunction<EmailService['isConfigured']>;
  sendEmail: jest.MockedFunction<EmailService['sendEmail']>;
  getReplyToAddress: jest.MockedFunction<EmailService['getReplyToAddress']>;
};

type MockTicketEmailThreads = Pick<
  TicketEmailThreadService,
  'recordOutboundEmail'
> & {
  recordOutboundEmail: jest.MockedFunction<
    TicketEmailThreadService['recordOutboundEmail']
  >;
};

describe('EmailProcessorService', () => {
  let service: EmailProcessorService;
  let outbox: MockOutbox;
  let email: MockEmail;
  let ticketEmailThreads: MockTicketEmailThreads;

  beforeEach(() => {
    outbox = {
      claimPending: jest.fn(),
      markFailed: jest.fn(),
      markSent: jest.fn(),
    };
    email = {
      isConfigured: jest.fn(),
      sendEmail: jest.fn(),
      getReplyToAddress: jest.fn(),
    };
    ticketEmailThreads = {
      recordOutboundEmail: jest.fn(),
    };

    service = new EmailProcessorService(
      outbox as unknown as OutboxService,
      email as unknown as EmailService,
      ticketEmailThreads as unknown as TicketEmailThreadService,
    );
  });

  it('does not send when another worker already claimed the outbox row', async () => {
    outbox.claimPending.mockResolvedValue(null);

    await service.process('outbox-1');

    expect(outbox.claimPending).toHaveBeenCalledWith('outbox-1');
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(ticketEmailThreads.recordOutboundEmail).not.toHaveBeenCalled();
  });

  it('sends and marks sent after successfully claiming a pending email', async () => {
    outbox.claimPending.mockResolvedValue({
      id: 'outbox-1',
      status: OutboxStatus.PROCESSING,
      toEmail: 'requester@example.com',
      subject: 'Subject',
      body: 'Body',
      payload: null,
      ticketId: null,
    } as Awaited<ReturnType<OutboxService['claimPending']>>);
    outbox.markSent.mockResolvedValue({
      id: 'outbox-1',
    } as Awaited<ReturnType<OutboxService['markSent']>>);
    email.isConfigured.mockReturnValue(true);
    email.getReplyToAddress.mockReturnValue('no-reply@example.com');
    email.sendEmail.mockResolvedValue(undefined);

    await service.process('outbox-1');

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(outbox.markSent).toHaveBeenCalledWith('outbox-1');
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });
});
