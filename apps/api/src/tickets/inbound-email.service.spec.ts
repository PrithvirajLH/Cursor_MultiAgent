import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessageType,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { TicketEmailThreadService } from '../notifications/ticket-email-thread.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAttachmentService } from './ticket-attachment.service';
import { InboundEmailService } from './inbound-email.service';
import { TicketRealtimeService } from './ticket-realtime.service';
import { TicketsService } from './tickets.service';

type MockConfig = {
  get: jest.Mock;
};

type MockPrisma = {
  ticket: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  ticketEvent: {
    create: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
};

type MockAttachmentService = {
  getAttachmentMaxBytes: jest.Mock;
  assertAttachmentWithinSizeLimit: jest.Mock;
  createTicketAttachmentFromBuffer: jest.Mock;
};

type MockTicketRealtime = {
  safeRealtime: jest.Mock;
  emitTicketRealtimeEvent: jest.Mock;
};

type MockNotifications = {
  inboundEmailAcknowledged: jest.Mock;
};

type MockTicketEmailThreads = {
  extractReplyToken: jest.Mock;
  resolveTicketIdByReplyAddress: jest.Mock;
  recordInboundEmail: jest.Mock;
};

type MockTicketsService = {
  create: jest.Mock;
  addMessage: jest.Mock;
  applyStatusTransitionInTx: jest.Mock;
};

function buildRequester() {
  return {
    id: 'requester-1',
    email: 'requester@example.com',
    displayName: 'Requester',
    role: UserRole.EMPLOYEE,
    primaryTeamId: null,
  };
}

function buildPayload() {
  return {
    fromEmail: 'requester@example.com',
    fromName: 'Requester',
    subject: 'Inbound email subject',
    body: 'Please help with this issue.',
    messageId: 'message-1@mail.example',
  };
}

describe('InboundEmailService', () => {
  let service: InboundEmailService;
  let prisma: MockPrisma;
  let config: MockConfig;
  let attachmentService: MockAttachmentService;
  let ticketRealtime: MockTicketRealtime;
  let notifications: MockNotifications;
  let ticketEmailThreads: MockTicketEmailThreads;
  let ticketsService: MockTicketsService;

  beforeEach(() => {
    prisma = {
      ticket: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      ticketEvent: {
        create: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'INBOUND_EMAIL_WEBHOOK_SECRET' ? 'secret' : undefined,
      ),
    };
    attachmentService = {
      getAttachmentMaxBytes: jest.fn().mockReturnValue(5_000_000),
      assertAttachmentWithinSizeLimit: jest.fn(),
      createTicketAttachmentFromBuffer: jest.fn(),
    };
    ticketRealtime = {
      safeRealtime: jest.fn(),
      emitTicketRealtimeEvent: jest.fn(),
    };
    notifications = {
      inboundEmailAcknowledged: jest.fn().mockResolvedValue(undefined),
    };
    ticketEmailThreads = {
      extractReplyToken: jest.fn(),
      resolveTicketIdByReplyAddress: jest.fn(),
      recordInboundEmail: jest.fn(),
    };
    ticketsService = {
      create: jest.fn(),
      addMessage: jest.fn(),
      applyStatusTransitionInTx: jest.fn(),
    };

    service = new InboundEmailService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      attachmentService as unknown as TicketAttachmentService,
      ticketRealtime as unknown as TicketRealtimeService,
      notifications as unknown as NotificationsService,
      ticketEmailThreads as unknown as TicketEmailThreadService,
      ticketsService as unknown as TicketsService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('finalizes the receipt instead of releasing it when create already succeeded', async () => {
    const payload = buildPayload();
    const requester = buildRequester();

    jest.spyOn(service, 'reserveInboundEmailReceipt').mockResolvedValue({
      mode: 'reserved',
      id: 'receipt-1',
    });
    jest
      .spyOn(service, 'findOrCreateInboundRequester')
      .mockResolvedValue(requester);
    jest.spyOn(service, 'resolveThreadTarget').mockResolvedValue(null);

    const completeSpy = jest
      .spyOn(service, 'completeInboundEmailReceipt')
      .mockResolvedValue(undefined);
    const releaseSpy = jest
      .spyOn(service, 'releaseInboundEmailReceipt')
      .mockResolvedValue(undefined);

    ticketsService.create.mockResolvedValue({
      id: 'ticket-1',
      subject: payload.subject,
    });
    ticketEmailThreads.recordInboundEmail.mockRejectedValue(
      new Error('post-persist failure'),
    );

    await expect(service.ingestInboundEmail(payload, 'secret')).rejects.toThrow(
      'post-persist failure',
    );

    expect(ticketsService.create).toHaveBeenCalledTimes(1);
    expect(completeSpy).toHaveBeenCalledWith('receipt-1', 'ticket-1', false);
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it('finalizes the receipt instead of releasing it when addMessage already succeeded', async () => {
    const payload = buildPayload();
    const requester = buildRequester();

    jest.spyOn(service, 'reserveInboundEmailReceipt').mockResolvedValue({
      mode: 'reserved',
      id: 'receipt-1',
    });
    jest
      .spyOn(service, 'findOrCreateInboundRequester')
      .mockResolvedValue(requester);
    jest.spyOn(service, 'resolveThreadTarget').mockResolvedValue({
      ticketId: 'ticket-1',
      threadedByReplyToken: null,
      threadedByDisplayId: null,
      threadedByOutboxId: null,
    });

    prisma.ticket.findFirst.mockResolvedValue({
      id: 'ticket-1',
      status: TicketStatus.NEW,
      priority: TicketPriority.SEV3,
      assignedTeamId: 'team-1',
      assigneeId: null,
      dueAt: null,
      slaPausedAt: null,
      resolvedAt: null,
      closedAt: null,
      completedAt: null,
    });

    const completeSpy = jest
      .spyOn(service, 'completeInboundEmailReceipt')
      .mockResolvedValue(undefined);
    const releaseSpy = jest
      .spyOn(service, 'releaseInboundEmailReceipt')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service, 'attachInboundEmailAttachments')
      .mockRejectedValue(new Error('attachment failure'));

    ticketsService.addMessage.mockResolvedValue({
      id: 'message-1',
      body: payload.body,
      type: MessageType.PUBLIC,
    });

    await expect(service.ingestInboundEmail(payload, 'secret')).rejects.toThrow(
      'attachment failure',
    );

    expect(ticketsService.addMessage).toHaveBeenCalledWith(
      'ticket-1',
      { body: payload.body, type: MessageType.PUBLIC },
      expect.objectContaining({ id: requester.id }),
    );
    expect(completeSpy).toHaveBeenCalledWith('receipt-1', 'ticket-1', true);
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it('still releases the receipt when the failure happens before any ticket mutation commits', async () => {
    const payload = buildPayload();

    jest.spyOn(service, 'reserveInboundEmailReceipt').mockResolvedValue({
      mode: 'reserved',
      id: 'receipt-1',
    });
    jest
      .spyOn(service, 'normalizeInboundEmailAttachments')
      .mockRejectedValue(new BadRequestException('invalid attachment'));

    const completeSpy = jest
      .spyOn(service, 'completeInboundEmailReceipt')
      .mockResolvedValue(undefined);
    const releaseSpy = jest
      .spyOn(service, 'releaseInboundEmailReceipt')
      .mockResolvedValue(undefined);

    await expect(service.ingestInboundEmail(payload, 'secret')).rejects.toThrow(
      BadRequestException,
    );

    expect(releaseSpy).toHaveBeenCalledWith('receipt-1');
    expect(completeSpy).not.toHaveBeenCalled();
    expect(ticketsService.create).not.toHaveBeenCalled();
    expect(ticketsService.addMessage).not.toHaveBeenCalled();
  });

  it('rejects contentUrl downloads when no attachment host allowlist is configured', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('fetch should not be called'));

    await expect(
      service.downloadInboundAttachmentBuffer(
        'https://files.example.com/inbound.txt',
        'inbound.txt',
        4,
      ),
    ).rejects.toThrow(
      'contentUrl downloads are disabled until INBOUND_EMAIL_ATTACHMENT_ALLOWED_HOSTS is configured',
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches allowed contentUrl attachments with redirects disabled', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'INBOUND_EMAIL_WEBHOOK_SECRET') {
        return 'secret';
      }
      if (key === 'INBOUND_EMAIL_ATTACHMENT_ALLOWED_HOSTS') {
        return 'files.example.com';
      }
      if (key === 'INBOUND_EMAIL_ATTACHMENT_FETCH_TIMEOUT_MS') {
        return '15000';
      }
      return undefined;
    });

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn().mockReturnValue('4'),
      },
      arrayBuffer: jest.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4])),
    } as unknown as Response);

    const buffer = await service.downloadInboundAttachmentBuffer(
      'https://files.example.com/inbound.txt',
      'inbound.txt',
      4,
    );

    expect(buffer).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://files.example.com/inbound.txt',
      expect.objectContaining({
        redirect: 'error',
      }),
    );
    const requestInit = fetchSpy.mock.calls[0]?.[1];
    expect(requestInit?.signal).toBeDefined();
  });
});
