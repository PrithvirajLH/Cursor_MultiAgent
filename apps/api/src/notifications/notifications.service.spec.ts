import { ConfigService } from '@nestjs/config';
import { EmailQueueService } from './email-queue.service';
import { InAppNotificationsService } from './in-app-notifications.service';
import { NotificationsService } from './notifications.service';
import { OutboxService } from './outbox.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

type MockOutbox = Pick<OutboxService, 'createEmail'> & {
  createEmail: jest.MockedFunction<OutboxService['createEmail']>;
};

type MockEmailQueue = Pick<EmailQueueService, 'enqueue'> & {
  enqueue: jest.MockedFunction<EmailQueueService['enqueue']>;
};

type MockTicketEmailThreads = Pick<
  TicketEmailThreadService,
  'getBaseReplyToAddress' | 'recordOutboundEmail'
> & {
  getBaseReplyToAddress: jest.MockedFunction<
    TicketEmailThreadService['getBaseReplyToAddress']
  >;
  recordOutboundEmail: jest.MockedFunction<
    TicketEmailThreadService['recordOutboundEmail']
  >;
};

type MockConfig = Pick<ConfigService, 'get'> & {
  get: jest.MockedFunction<ConfigService['get']>;
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let outbox: MockOutbox;
  let emailQueue: MockEmailQueue;
  let ticketEmailThreads: MockTicketEmailThreads;
  let config: MockConfig;

  beforeEach(() => {
    outbox = {
      createEmail: jest.fn(),
    };
    emailQueue = {
      enqueue: jest.fn(),
    };
    ticketEmailThreads = {
      getBaseReplyToAddress: jest.fn(),
      recordOutboundEmail: jest.fn(),
    };
    config = {
      get: jest.fn(),
    };

    ticketEmailThreads.getBaseReplyToAddress.mockReturnValue(
      'helpdesk@example.com',
    );
    config.get.mockImplementation((key: string) => {
      if (key === 'WEB_APP_URL') {
        return 'http://localhost:5173';
      }
      return undefined;
    });

    service = new NotificationsService(
      {} as never,
      outbox as unknown as OutboxService,
      emailQueue as unknown as EmailQueueService,
      config as unknown as ConfigService,
      {} as InAppNotificationsService,
      ticketEmailThreads as unknown as TicketEmailThreadService,
      // Card 1.33: a public reply drops suppressed addresses before composing.
      { isSuppressed: jest.fn().mockResolvedValue(false) } as never,
    );
  });

  it('writes no thread pointer when it queues an email', async () => {
    // This replaces a test that asserted the opposite - that the pointer was
    // reserved BEFORE the send was attempted. That was the bug, not the
    // behaviour: a row that then failed to send left the whole ticket
    // referencing a message that reached nobody (card 1.33, fault 1). Only
    // recordOutboundEmail may write it, and only after markSent.
    outbox.createEmail.mockResolvedValue({
      id: 'outbox-1',
    } as Awaited<ReturnType<OutboxService['createEmail']>>);
    emailQueue.enqueue.mockResolvedValue(undefined);

    await service.notifyAddresses(['requester@example.com'], {
      eventType: 'TICKET_STATUS_CHANGED',
      subject: 'Network is Down [AI_20260220_001]',
      body: 'Status changed from CLOSED to REOPENED.',
      ticketId: 'ticket-1',
      emailMetadata: {
        replyTo: 'support+ticket-abc123@example.com',
      },
    });

    expect(outbox.createEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: 'requester@example.com',
        ticketId: 'ticket-1',
        eventType: 'TICKET_STATUS_CHANGED',
      }),
    );
    expect(emailQueue.enqueue).toHaveBeenCalledWith('outbox-1');
    expect(ticketEmailThreads.recordOutboundEmail).not.toHaveBeenCalled();
  });
});
