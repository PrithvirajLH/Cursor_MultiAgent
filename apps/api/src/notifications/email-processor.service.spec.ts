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

  /** A claimed row with whatever event payload the test needs. */
  function claimRow(eventPayload: Record<string, unknown> | null) {
    outbox.claimPending.mockResolvedValue({
      id: 'outbox-1',
      status: OutboxStatus.PROCESSING,
      toEmail: 'requester@example.com',
      subject: 'Subject',
      body: 'Body',
      payload: eventPayload === null ? null : { event: eventPayload },
      ticketId: null,
    } as Awaited<ReturnType<OutboxService['claimPending']>>);
    outbox.markSent.mockResolvedValue({
      id: 'outbox-1',
    } as Awaited<ReturnType<OutboxService['markSent']>>);
    email.isConfigured.mockReturnValue(true);
    email.getReplyToAddress.mockReturnValue('no-reply@example.com');
    email.sendEmail.mockResolvedValue(undefined);
  }

  it('passes the agent name on to the send when the payload carries one', async () => {
    claimRow({ messageId: 'm1', agentDisplayName: 'Sarah Chen' });

    await service.process('outbox-1');

    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ agentDisplayName: 'Sarah Chen' }),
    );
  });

  it('sends no agent name for a worker-raised notification', async () => {
    // The five system-raised queueEmails call sites omit the field entirely,
    // which is how they keep the generic desk identity.
    claimRow({ messageId: 'm1' });

    await service.process('outbox-1');

    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ agentDisplayName: undefined }),
    );
  });

  it('ignores a blank agent name rather than sending an empty display name', async () => {
    claimRow({ messageId: 'm1', agentDisplayName: '   ' });

    await service.process('outbox-1');

    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ agentDisplayName: undefined }),
    );
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
