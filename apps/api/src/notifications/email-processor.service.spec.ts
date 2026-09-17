import { OutboxStatus } from '@prisma/client';
import { EmailService } from './email.service';
import { EmailProcessorService } from './email-processor.service';
import { InlineEmailImagesService } from '../common/inline-email-images.service';
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
  let inlineEmailImages: { readInlineImages: jest.Mock };

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
    // ⚠️ CARD 1.130: never consulted unless a payload carries inline image
    // ids, so every case written before that card is unaffected by it.
    inlineEmailImages = { readInlineImages: jest.fn().mockResolvedValue([]) };

    service = new EmailProcessorService(
      outbox as unknown as OutboxService,
      email as unknown as EmailService,
      ticketEmailThreads as unknown as TicketEmailThreadService,
      inlineEmailImages as unknown as InlineEmailImagesService,
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

  describe('inline images travel with the email (card 1.130)', () => {
    /** A claimed row whose content half carries inline image ids. */
    function claimWithInlineImages(
      inlineImages: { attachmentId: string; cid: string }[],
      ticketId: string | null = 'ticket-1',
    ) {
      outbox.claimPending.mockResolvedValue({
        id: 'outbox-1',
        status: OutboxStatus.PROCESSING,
        toEmail: 'requester@example.com',
        subject: 'Subject',
        body: 'Body',
        payload: { content: { html: '<p>hi</p>', inlineImages } },
        ticketId,
      } as unknown as Awaited<ReturnType<OutboxService['claimPending']>>);
      outbox.markSent.mockResolvedValue({
        id: 'outbox-1',
      } as Awaited<ReturnType<OutboxService['markSent']>>);
      email.isConfigured.mockReturnValue(true);
      email.getReplyToAddress.mockReturnValue('no-reply@example.com');
      email.sendEmail.mockResolvedValue(undefined);
      // ⚠️ These are the first rows in this file with a NON-NULL ticketId, so
      // they are the first to reach `recordOutboundEmail` at all - and a
      // `jest.fn()` returning undefined has no `.catch`.
      ticketEmailThreads.recordOutboundEmail.mockResolvedValue(
        undefined as unknown as Awaited<
          ReturnType<TicketEmailThreadService['recordOutboundEmail']>
        >,
      );
    }

    it('⚠️ reads the files and hands them to the transport', async () => {
      // THE WIRING THIS CARD EXISTS FOR: ids in the payload, bytes read here.
      const image = {
        attachmentId: 'att-1',
        cid: 'att-1@csnhc.com',
        filename: 'screenshot.png',
        contentType: 'image/png',
        content: Buffer.from('PNG'),
      };
      inlineEmailImages.readInlineImages.mockResolvedValue([image]);
      claimWithInlineImages([{ attachmentId: 'att-1', cid: 'att-1@csnhc.com' }]);

      await service.process('outbox-1');

      expect(inlineEmailImages.readInlineImages).toHaveBeenCalledWith(
        'ticket-1',
        [{ attachmentId: 'att-1', cid: 'att-1@csnhc.com' }],
      );
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ attachments: [image] }),
      );
    });

    it('sends no attachments key at all when there are no inline images', async () => {
      // NON-VACUITY: every email that carries no image must produce exactly
      // what it produced before this card.
      claimWithInlineImages([]);

      await service.process('outbox-1');

      expect(inlineEmailImages.readInlineImages).not.toHaveBeenCalled();
      const sent = email.sendEmail.mock.calls[0][0] as Record<string, unknown>;
      expect('attachments' in sent).toBe(false);
    });

    it('⚠️ still sends when every image is refused or unreadable', async () => {
      // Card 1.105's principle: a reply that cannot be sent because a picture
      // is missing is worse than a reply without the picture.
      inlineEmailImages.readInlineImages.mockResolvedValue([]);
      claimWithInlineImages([{ attachmentId: 'att-1', cid: 'att-1@csnhc.com' }]);

      await service.process('outbox-1');

      expect(email.sendEmail).toHaveBeenCalledTimes(1);
      expect(outbox.markSent).toHaveBeenCalledWith('outbox-1');
      const sent = email.sendEmail.mock.calls[0][0] as Record<string, unknown>;
      expect('attachments' in sent).toBe(false);
    });

    it('does not look for files on a row with no ticket', async () => {
      claimWithInlineImages(
        [{ attachmentId: 'att-1', cid: 'att-1@csnhc.com' }],
        null,
      );

      await service.process('outbox-1');

      expect(inlineEmailImages.readInlineImages).not.toHaveBeenCalled();
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
    });
  });
});
