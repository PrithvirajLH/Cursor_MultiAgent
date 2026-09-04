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
import { DuplicateAccountService } from '../common/duplicate-account.service';
import { UserIdentityService } from '../common/user-identity.service';
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
const CUSTOM_FIELDS_NEED_DEPARTMENT =
  'customFields requires an explicit department: without one the routing rules choose the team, so field names cannot be resolved.';

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
    private readonly duplicateAccounts: DuplicateAccountService,
    private readonly userIdentity: UserIdentityService,
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
    const customFieldValues = await this.resolveCustomFieldValues(
      payload.customFields,
      payload.department,
      assignedTeamId,
      categoryId,
    );
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
        customFieldValues,
      },
      this.toIntakeRequesterAuthUser(requester),
      // The integration already told the submitter their form went through, so
      // a second "we have logged your request" from us is noise at best.
      //
      // At worst it is confusing: a PAF ticket is created when the flow
      // COMPLETES, which is the approval date, not the submission date — every
      // ticket carries an `Approval Date` custom field equal to its creation
      // day. When an approver is away, the submitter fills a form and then
      // hears "We have logged your request" days or weeks later, in the present
      // tense, with nothing but a reference number to connect it to what they
      // did. Observed in production 2026-09-04 on PA_20260904_165.
      //
      // Same reasoning as the inbound-email path, which has always suppressed
      // this. If an acknowledgement is wanted, it belongs to the integration at
      // submission time — the moment the person is actually waiting to hear
      // something — not to us at approval time.
      { suppressCreatedEmail: true },
    );
    await this.recordIntakeEvent(created.id, payload, requester.id);
    return this.buildIntakeResponse(created.id);
  }

  /**
   * Map the caller's `{ "Field name": "value" }` onto custom field ids for the
   * resolved department, and refuse early — naming the department — when a
   * required field is missing. Returns undefined when there is nothing to map,
   * which leaves `TicketsService.create` to enforce required fields as it does
   * for every other caller.
   */
  private async resolveCustomFieldValues(
    supplied: Record<string, string> | undefined,
    departmentSlug: string | undefined,
    assignedTeamId: string | undefined,
    categoryId: string | undefined,
  ): Promise<{ customFieldId: string; value: string }[] | undefined> {
    if (!assignedTeamId) {
      if (supplied && Object.keys(supplied).length > 0) {
        throw new BadRequestException(CUSTOM_FIELDS_NEED_DEPARTMENT);
      }
      return undefined;
    }
    const applicable = await this.prisma.customField.findMany({
      where: {
        AND: [
          { OR: [{ teamId: null }, { teamId: assignedTeamId }] },
          { OR: [{ categoryId: null }, { categoryId: categoryId ?? null }] },
        ],
      },
      select: { id: true, name: true, isRequired: true },
      orderBy: { sortOrder: 'asc' },
    });
    const slug = departmentSlug ?? '';
    const byName = new Map(
      applicable.map((field) => [field.name.trim().toLowerCase(), field]),
    );
    const values: { customFieldId: string; value: string }[] = [];
    for (const [name, value] of Object.entries(supplied ?? {})) {
      const field = byName.get(name.trim().toLowerCase());
      if (!field) {
        throw new BadRequestException(
          `Unknown field "${name}" for department "${slug}". Valid: ${applicable.map((entry) => entry.name).join(', ') || 'none'}`,
        );
      }
      values.push({ customFieldId: field.id, value });
    }
    const provided = new Set(
      values
        .filter((entry) => entry.value.trim() !== '')
        .map((entry) => entry.customFieldId),
    );
    const missing = applicable.filter(
      (field) => field.isRequired && !provided.has(field.id),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Department "${slug}" requires: ${missing.map((field) => field.name).join(', ')}`,
      );
    }
    return values.length > 0 ? values : undefined;
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

    // Card 1.30: before creating anyone, ask whether the directory has told us
    // this address belongs to a human we already have. Entra hands out a UPN
    // and a `mail` that routinely differ, and this path only ever sees the
    // second one - which is how the duplicate account was made.
    //
    // The mapping was GIVEN to us at login, never inferred: nothing here
    // compares the shape of two addresses. An unrecognised address simply falls
    // through and provisions as before, because resolution must never be able
    // to block provisioning.
    const aliasUserId = await this.userIdentity.findUserIdByAlias(
      normalizedEmail,
    );
    if (aliasUserId) {
      const byAlias = await this.prisma.user.findUnique({
        where: { id: aliasUserId },
        select: REQUESTER_SELECT,
      });
      if (byAlias) {
        return byAlias;
      }
    }
    try {
      const created = await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          displayName: name?.trim() || normalizedEmail,
          role: UserRole.EMPLOYEE,
        },
        select: REQUESTER_SELECT,
      });
      // Card 1.30: say so if this looks like a second account for somebody we
      // already have. After the create, never before - flagging must not be
      // able to stop a user being provisioned. Rejecting an intake form
      // would be the same failure by another route.
      await this.duplicateAccounts.flag(created.email, created.role);
      return created;
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
