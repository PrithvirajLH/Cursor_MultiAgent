import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { AccessControlService } from '../common/access-control.service';
import { AutomationQueueService } from '../common/automation-queue.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SlaEngineService } from '../slas/sla-engine.service';
import { InboundEmailService } from './inbound-email.service';
import { TicketAttachmentService } from './ticket-attachment.service';
import { TicketRealtimeService } from './ticket-realtime.service';
import { TicketSlaCalculationService } from './ticket-sla-calculation.service';
import { TagsService } from '../tags/tags.service';
import { TicketsService } from './tickets.service';

function callIsPauseStatus(service: TicketsService, status: TicketStatus) {
  return (
    service as unknown as {
      isPauseStatus(statusValue: TicketStatus): boolean;
    }
  ).isPauseStatus(status);
}

function callBuildDisplayId(
  service: TicketsService,
  teamName: string | null,
  createdAt: Date,
  ticketNumber: number,
) {
  return (
    service as unknown as {
      buildDisplayId(
        teamNameValue: string | null,
        createdAtValue: Date,
        ticketNumberValue: number,
      ): string;
    }
  ).buildDisplayId(teamName, createdAt, ticketNumber);
}

function callIsValidTransition(
  service: TicketsService,
  from: TicketStatus,
  to: TicketStatus,
) {
  return (
    service as unknown as {
      isValidTransition(
        fromStatus: TicketStatus,
        toStatus: TicketStatus,
      ): boolean;
    }
  ).isValidTransition(from, to);
}

describe('TicketsService', () => {
  let service: TicketsService;

  beforeEach(() => {
    const configServiceMock = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    service = new TicketsService(
      {} as PrismaService,
      {} as NotificationsService,
      configServiceMock,
      {} as SlaEngineService,
      {} as CustomFieldsService,
      {} as AutomationQueueService,
      {} as AccessControlService,
      {} as Cache,
      {} as TicketAttachmentService,
      {} as TicketRealtimeService,
      {} as TicketSlaCalculationService,
      {} as InboundEmailService,
      {} as TagsService,
    );
  });

  describe('isPauseStatus (private)', () => {
    it('returns true for WAITING_ON_REQUESTER and WAITING_ON_VENDOR', () => {
      expect(
        callIsPauseStatus(service, TicketStatus.WAITING_ON_REQUESTER),
      ).toBe(true);
      expect(callIsPauseStatus(service, TicketStatus.WAITING_ON_VENDOR)).toBe(
        true,
      );
    });

    it('returns false for other statuses', () => {
      expect(callIsPauseStatus(service, TicketStatus.NEW)).toBe(false);
      expect(callIsPauseStatus(service, TicketStatus.IN_PROGRESS)).toBe(false);
      expect(callIsPauseStatus(service, TicketStatus.RESOLVED)).toBe(false);
      expect(callIsPauseStatus(service, TicketStatus.CLOSED)).toBe(false);
    });
  });

  describe('buildDisplayId (private)', () => {
    it('formats a standard ID for no team', () => {
      const date = new Date('2024-03-15T12:00:00.000Z');
      const displayId = callBuildDisplayId(service, null, date, 42);
      expect(displayId).toBe(`NA_20240315_042`);
    });

    it('formats an ID using the team name to create a department code', () => {
      const date = new Date('2025-11-05T08:30:00.000Z');
      const displayId = callBuildDisplayId(
        service,
        'Customer Support',
        date,
        128,
      );
      expect(displayId).toBe(`CS_20251105_128`);
    });

    it('handles padding correctly for sequence numbers', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const displayId = callBuildDisplayId(service, 'IT Helpdesk', date, 5);
      expect(displayId).toBe(`IH_20240101_005`);
    });

    it('uses the UTC date for the prefix, not the server-local date (BUG-13)', () => {
      // 2024-03-15T23:30:00Z is still 2024-03-15 in UTC but would be 2024-03-16
      // in any timezone east of UTC (and earlier in some western zones). The
      // prefix must follow UTC regardless of the server timezone.
      const date = new Date('2024-03-15T23:30:00.000Z');
      const displayId = callBuildDisplayId(service, null, date, 7);
      expect(displayId).toBe(`NA_20240315_007`);

      // A timestamp just past midnight UTC must roll to the next UTC day.
      const nextDay = new Date('2024-03-16T00:30:00.000Z');
      expect(callBuildDisplayId(service, null, nextDay, 8)).toBe(
        `NA_20240316_008`,
      );
    });
  });

  describe('isValidTransition (private)', () => {
    it('always allows transition to the same status', () => {
      expect(
        callIsValidTransition(service, TicketStatus.NEW, TicketStatus.NEW),
      ).toBe(true);
      expect(
        callIsValidTransition(
          service,
          TicketStatus.RESOLVED,
          TicketStatus.RESOLVED,
        ),
      ).toBe(true);
    });

    it('allows valid transitions according to default configurations', () => {
      expect(
        callIsValidTransition(service, TicketStatus.NEW, TicketStatus.ASSIGNED),
      ).toBe(true);
      expect(
        callIsValidTransition(
          service,
          TicketStatus.ASSIGNED,
          TicketStatus.IN_PROGRESS,
        ),
      ).toBe(true);
      expect(
        callIsValidTransition(
          service,
          TicketStatus.RESOLVED,
          TicketStatus.CLOSED,
        ),
      ).toBe(true);
    });

    it('rejects invalid transitions', () => {
      expect(
        callIsValidTransition(service, TicketStatus.NEW, TicketStatus.CLOSED),
      ).toBe(false);
      expect(
        callIsValidTransition(
          service,
          TicketStatus.CLOSED,
          TicketStatus.ASSIGNED,
        ),
      ).toBe(false);
    });
  });

  describe('applyStatusTransitionInTx (BUG-08: same-status no-op)', () => {
    function buildSnapshot(
      status: TicketStatus,
      assigneeId: string | null = 'agent-1',
    ) {
      return {
        id: 'ticket-1',
        status,
        priority: TicketPriority.SEV3,
        assignedTeamId: 'team-1',
        assigneeId,
        dueAt: null,
        slaPausedAt: null,
        resolvedAt: null,
        closedAt: null,
        completedAt: null,
      };
    }

    function buildTxMock() {
      return {
        ticket: { update: jest.fn().mockResolvedValue({}) },
        ticketEvent: { create: jest.fn().mockResolvedValue({}) },
      };
    }

    function callApply(
      tx: unknown,
      snapshot: ReturnType<typeof buildSnapshot>,
      newStatus: TicketStatus,
    ) {
      return (
        service as unknown as {
          applyStatusTransitionInTx(
            txClient: unknown,
            ticket: ReturnType<typeof buildSnapshot>,
            status: TicketStatus,
            actorId: string,
          ): Promise<void>;
        }
      ).applyStatusTransitionInTx(tx, snapshot, newStatus, 'actor-1');
    }

    it('does not write a TICKET_STATUS_CHANGED event or run SLA sync when status is unchanged', async () => {
      const syncSpy = jest.fn().mockResolvedValue(undefined);
      (service as unknown as { slaEngine: { syncFromTicket: jest.Mock } }).slaEngine =
        { syncFromTicket: syncSpy };

      const tx = buildTxMock();
      await callApply(
        tx,
        buildSnapshot(TicketStatus.IN_PROGRESS),
        TicketStatus.IN_PROGRESS,
      );

      expect(tx.ticketEvent.create).not.toHaveBeenCalled();
      expect(tx.ticket.update).not.toHaveBeenCalled();
      expect(syncSpy).not.toHaveBeenCalled();
    });

    it('still writes the event and runs SLA sync for a real transition', async () => {
      const syncSpy = jest.fn().mockResolvedValue(undefined);
      (service as unknown as { slaEngine: { syncFromTicket: jest.Mock } }).slaEngine =
        { syncFromTicket: syncSpy };

      const tx = buildTxMock();
      await callApply(
        tx,
        buildSnapshot(TicketStatus.ASSIGNED),
        TicketStatus.IN_PROGRESS,
      );

      expect(tx.ticket.update).toHaveBeenCalledTimes(1);
      expect(tx.ticketEvent.create).toHaveBeenCalledTimes(1);
      expect(tx.ticketEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TICKET_STATUS_CHANGED',
            payload: {
              from: TicketStatus.ASSIGNED,
              to: TicketStatus.IN_PROGRESS,
            },
          }),
        }),
      );
      expect(syncSpy).toHaveBeenCalledTimes(1);
    });
  });
});
