import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitCsatDto } from './dto/submit-csat.dto';
import type { AuthUser } from '../auth/current-user.decorator';

@Injectable()
export class CsatService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getForTicket(ticketId: string) {
    const event = await this.prisma.ticketEvent.findFirst({
      where: { ticketId, type: 'CSAT_SUBMITTED' },
      select: { id: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return event;
  }
}
