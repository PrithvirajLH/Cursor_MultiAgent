import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketChannel, TicketPriority, UserRole } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIntakeTicketDto } from './dto/create-intake-ticket.dto';
import type { IntakeTicketResponse } from './intake-ticket-response.type';
import { TicketsService } from './tickets.service';

type IntakeRequester = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  primaryTeamId: string | null;
};

const REQUESTER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  primaryTeamId: true,
} as const;
const INTAKE_EVENT_TYPE = 'TICKET_CREATED_VIA_INTAKE';

/**
 * Integration intake (card 1.19): creates a ticket for a named person in a
 * named department on behalf of an outside system (Power Automate), gated by a
 * shared secret. Deliberately separate from the inbound-email webhook — this
 * path has no email semantics, no threading and no attachments.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ticketsService: TicketsService,
  ) {}

  /**
   * Constant-time check of the `x-intake-secret` header against
   * `INTAKE_API_SECRET`. Throws `ForbiddenException` when the setting is
   * missing, the header is absent, or the two differ.
   */
  assertIntakeSecret(intakeSecret: string | undefined): void {
    const configuredSecret = this.config.get<string>('INTAKE_API_SECRET');
    if (!configuredSecret) {
      throw new ForbiddenException('Intake API secret is not configured');
    }
    if (!intakeSecret) {
      throw new ForbiddenException('Missing intake API secret');
    }
    const expected = Buffer.from(configuredSecret, 'utf8');
    const received = Buffer.from(intakeSecret, 'utf8');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ForbiddenException('Invalid intake API secret');
    }
  }

  /**
   * Create one ticket from an integration payload. An explicit `department`
   * slug wins over the routing rules; omitting it leaves routing in charge.
   * Retry safety comes from the shared `Idempotency-Key` interceptor, not from
   * this method.
   */
  async createTicket(
    payload: CreateIntakeTicketDto,
    intakeSecret: string | undefined,
  ): Promise<IntakeTicketResponse> {
    this.assertIntakeSecret(intakeSecret);
    const assignedTeamId = payload.department
      ? await this.resolveTeamIdBySlug(payload.department)
      : undefined;
    const categoryId = payload.category
      ? await this.resolveCategoryIdBySlug(payload.category)
      : undefined;
    const requester = await this.findOrCreateIntakeRequester(
      payload.requesterEmail,
      payload.requesterName,
    );
    const created = await this.ticketsService.create(
      {
        subject: payload.subject,
        description: payload.description,
        priority: payload.priority ?? TicketPriority.SEV3,
        channel: TicketChannel.API,
        requesterId: requester.id,
        assignedTeamId,
        categoryId,
        tags: payload.tags,
      },
      this.toIntakeRequesterAuthUser(requester),
    );
    await this.recordIntakeEvent(created.id, payload, requester.id);
    return this.buildIntakeResponse(created.id);
  }

  /** Active team by slug, or a 400 that names the slugs a flow may use. */
  private async resolveTeamIdBySlug(slug: string): Promise<string> {
    const team = await this.prisma.team.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (team) {
      return team.id;
    }
    const active = await this.prisma.team.findMany({
      where: { isActive: true },
      select: { slug: true },
      orderBy: { slug: 'asc' },
    });
    throw new BadRequestException(
      `Unknown department "${slug}". Valid: ${active.map((entry) => entry.slug).join(', ')}`,
    );
  }

  /** Active category by slug, or a 400 that names the valid slugs. */
  private async resolveCategoryIdBySlug(slug: string): Promise<string> {
    const category = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (category) {
      return category.id;
    }
    const active = await this.prisma.category.findMany({
      where: { isActive: true },
      select: { slug: true },
      orderBy: { slug: 'asc' },
    });
    throw new BadRequestException(
      `Unknown category "${slug}". Valid: ${active.map((entry) => entry.slug).join(', ')}`,
    );
  }

  /** Existing user by lowercased email, or a new EMPLOYEE (as inbound email does). */
  private async findOrCreateIntakeRequester(
    email: string,
    name?: string,
  ): Promise<IntakeRequester> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: REQUESTER_SELECT,
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          displayName: name?.trim() || normalizedEmail,
          role: UserRole.EMPLOYEE,
        },
        select: REQUESTER_SELECT,
      });
    } catch {
      const concurrentCreate = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: REQUESTER_SELECT,
      });
      if (!concurrentCreate) {
        throw new BadRequestException('Unable to resolve intake requester');
      }
      return concurrentCreate;
    }
  }

  private toIntakeRequesterAuthUser(requester: IntakeRequester): AuthUser {
    return {
      id: requester.id,
      email: requester.email,
      displayName: requester.displayName,
      role: requester.role,
      primaryTeamId: requester.primaryTeamId,
      teamId: requester.primaryTeamId,
    };
  }

  /** Timeline entry showing the ticket arrived from an integration. Never fatal. */
  private async recordIntakeEvent(
    ticketId: string,
    payload: CreateIntakeTicketDto,
    requesterId: string,
  ): Promise<void> {
    await this.prisma.ticketEvent
      .create({
        data: {
          ticketId,
          type: INTAKE_EVENT_TYPE,
          payload: {
            sourceRef: payload.sourceRef ?? null,
            department: payload.department ?? null,
            byIntegration: true,
          },
          createdById: requesterId,
        },
      })
      .catch((error) =>
        this.logger.error(
          `Failed to record intake event for ticket ${ticketId}`,
          (error as Error).stack,
        ),
      );
  }

  private async buildIntakeResponse(
    ticketId: string,
  ): Promise<IntakeTicketResponse> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        number: true,
        displayId: true,
        status: true,
        priority: true,
        channel: true,
        assignedTeam: { select: { id: true, name: true, slug: true } },
        category: { select: { id: true, name: true, slug: true } },
        requester: { select: { id: true, email: true, displayName: true } },
      },
    });
    if (!ticket) {
      throw new BadRequestException('Intake ticket could not be read back');
    }
    return ticket;
  }
}
