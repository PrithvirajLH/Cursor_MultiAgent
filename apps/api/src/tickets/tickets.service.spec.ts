import { ConfigService } from '@nestjs/config';
import { TicketStatus } from '@prisma/client';
import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
    let service: TicketsService;

    beforeEach(() => {
        // We only provide the config service mock for parsing status transitions.
        // The other dependencies are not needed for testing private pure logic.
        const configServiceMock = {
            get: jest.fn().mockReturnValue(undefined), // Fallback to default transitions
        } as unknown as ConfigService;

        // Use `as any` casting for missing dependencies to allow testing isolated pure methods
        service = new TicketsService(
            {} as any, // 1. prisma
            {} as any, // 2. notifications
            configServiceMock, // 3. config
            {} as any, // 4. slaEngine
            {} as any, // 5. ticketRealtime
            {} as any, // 6. slaCalc
            {} as any, // 7. inboundEmailService
            {} as any, // 8. ticketAttachmentService
            {} as any, // 9. automationQueue
            {} as any, // 10. ticketEmailThreadService
            {} as any, // 11. routingRulesService
            {} as any, // 12. pinoLogger
        );
    });

    describe('isPauseStatus (private)', () => {
        it('returns true for WAITING_ON_REQUESTER and WAITING_ON_VENDOR', () => {
            expect((service as any).isPauseStatus(TicketStatus.WAITING_ON_REQUESTER)).toBe(true);
            expect((service as any).isPauseStatus(TicketStatus.WAITING_ON_VENDOR)).toBe(true);
        });

        it('returns false for other statuses', () => {
            expect((service as any).isPauseStatus(TicketStatus.NEW)).toBe(false);
            expect((service as any).isPauseStatus(TicketStatus.IN_PROGRESS)).toBe(false);
            expect((service as any).isPauseStatus(TicketStatus.RESOLVED)).toBe(false);
            expect((service as any).isPauseStatus(TicketStatus.CLOSED)).toBe(false);
        });
    });

    describe('buildDisplayId (private)', () => {
        it('formats a standard ID for no team', () => {
            const date = new Date('2024-03-15T12:00:00.000Z');
            const displayId = (service as any).buildDisplayId(null, date, 42);
            // Timezone is a factor depending on local env format, but the date components are formatted from the `Date` object values:
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            expect(displayId).toBe(`NA_${yyyy}${mm}${dd}_042`);
        });

        it('formats an ID using the team name to create a department code', () => {
            const date = new Date('2025-11-05T08:30:00.000Z');
            const displayId = (service as any).buildDisplayId('Customer Support', date, 128);
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            expect(displayId).toBe(`CS_${yyyy}${mm}${dd}_128`);
        });

        it('handles padding correctly for sequence numbers', () => {
            const date = new Date('2024-01-01T00:00:00.000Z');
            const displayId = (service as any).buildDisplayId('IT Helpdesk', date, 5);
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            expect(displayId).toBe(`IH_${yyyy}${mm}${dd}_005`);
        });
    });

    describe('isValidTransition (private)', () => {
        it('always allows transition to the same status', () => {
            expect((service as any).isValidTransition(TicketStatus.NEW, TicketStatus.NEW)).toBe(true);
            expect((service as any).isValidTransition(TicketStatus.RESOLVED, TicketStatus.RESOLVED)).toBe(true);
        });

        it('allows valid transitions according to default configurations', () => {
            expect((service as any).isValidTransition(TicketStatus.NEW, TicketStatus.ASSIGNED)).toBe(true);
            expect((service as any).isValidTransition(TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS)).toBe(true);
            expect((service as any).isValidTransition(TicketStatus.RESOLVED, TicketStatus.CLOSED)).toBe(true);
        });

        it('rejects invalid transitions', () => {
            expect((service as any).isValidTransition(TicketStatus.NEW, TicketStatus.CLOSED)).toBe(false);
            expect((service as any).isValidTransition(TicketStatus.CLOSED, TicketStatus.ASSIGNED)).toBe(false);
        });
    });
});
