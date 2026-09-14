import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitCsatDto } from './dto/submit-csat.dto';
import type { AuthUser } from '../auth/current-user.decorator';

@Injectable()
export class CsatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async submit(dto: SubmitCsatDto, user: AuthUser) {
    // 1. Verify ticket exists and user is the requester
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: dto.ticketId },
      select: { id: true, status: true, requesterId: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.requesterId !== user.id) {
      throw new ForbiddenException('Only the requester can submit CSAT');
    }

    if (!['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      throw new BadRequestException('CSAT can only be submitted for resolved or closed tickets');
    }

    // 2. Check if CSAT already submitted
    const existing = await this.prisma.ticketEvent.findFirst({
      where: { ticketId: dto.ticketId, type: 'CSAT_SUBMITTED' },
    });

    if (existing) {
      throw new BadRequestException('CSAT has already been submitted for this ticket');
    }

    // 3. Create TicketEvent with CSAT data
    return this.prisma.ticketEvent.create({
      data: {
        ticketId: dto.ticketId,
        type: 'CSAT_SUBMITTED',
        payload: {
          rating: dto.rating,
          comment: dto.comment ?? null,
        },
        createdById: user.id,
      },
    });
  }

  /**
   * The rating and comment left on a ticket (card 1.79).
   *
   * ⚠️ THIS WAS UNGUARDED AND LIVE: the controller took no `@CurrentUser`
   * and this method took no user, so ANY signed-in person could read ANY
   * ticket's rating and its free-text comment by knowing an id. Every other
   * ticket-derived read in this application goes through the visibility
   * chokepoint; these two never did.
   *
   * ⚠️ 404, NOT 403, for a ticket this person cannot see - mirroring
   * `listEvents`. A 403 would confirm to an outsider that the ticket exists.
   *
   * @param ticketId The ticket whose rating is wanted.
   * @param user The caller, whose visibility decides the answer.
   * @returns The most recent CSAT event, or null when none was left.
   */
  async getForTicket(ticketId: string, user: AuthUser) {
    const visible = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        ...this.accessControl.buildTicketAccessFilter(user),
      },
      select: { id: true },
    });
    if (!visible) {
      throw new NotFoundException('Ticket not found');
    }

    const event = await this.prisma.ticketEvent.findFirst({
      where: { ticketId, type: 'CSAT_SUBMITTED' },
      select: { id: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return event;
  }
}
