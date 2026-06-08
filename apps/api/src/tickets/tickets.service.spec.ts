import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { TicketStatus } from '@prisma/client';
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
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      expect(displayId).toBe(`NA_${yyyy}${mm}${dd}_042`);
    });

    it('formats an ID using the team name to create a department code', () => {
      const date = new Date('2025-11-05T08:30:00.000Z');
      const displayId = callBuildDisplayId(
        service,
        'Customer Support',
        date,
        128,
      );
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      expect(displayId).toBe(`CS_${yyyy}${mm}${dd}_128`);
    });

    it('handles padding correctly for sequence numbers', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const displayId = callBuildDisplayId(service, 'IT Helpdesk', date, 5);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      expect(displayId).toBe(`IH_${yyyy}${mm}${dd}_005`);
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
});
