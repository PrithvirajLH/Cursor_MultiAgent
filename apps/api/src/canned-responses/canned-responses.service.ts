import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from '../common/access-control.service';
import { RuleEngineService } from '../automation/rule-engine.service';
import { MACRO_ALLOWED_ACTIONS } from '../automation/macro-allowed-actions.util';
import { fillTemplateVars } from '../automation/template-vars.util';
import { buildMacroVars } from './build-macro-vars.util';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';

/** One action as stored on a canned response. */
type StoredAction = { type: string } & Record<string, unknown>;

@Injectable()
export class CannedResponsesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
    private readonly ruleEngine: RuleEngineService,
  ) {}

  async list(user: AuthUser) {
    const orConditions: Array<{ userId: string } | { teamId: string }> = [
      { userId: user.id },
    ];
    if (user.teamId) {
      orConditions.push({ teamId: user.teamId });
    }
    const items = await this.prisma.cannedResponse.findMany({
      where: { OR: orConditions },
      orderBy: { name: 'asc' },
    });
    return { data: items };
  }

  async create(dto: CreateCannedResponseDto, user: AuthUser) {
    const actions = this.assertActionsAllowed(dto.actions);
    const teamId =
      dto.teamId != null && user.teamId != null && dto.teamId === user.teamId
        ? dto.teamId
        : null;
    const item = await this.prisma.cannedResponse.create({
      data: {
        name: dto.name,
        content: dto.content,
        actions,
        userId: user.id,
        teamId,
      },
    });
    return item;
  }

  async update(id: string, dto: UpdateCannedResponseDto, user: AuthUser) {
    const existing = await this.prisma.cannedResponse.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Canned response not found');
    }
    if (existing.userId !== user.id) {
      throw new ForbiddenException(
        'You can only edit your own canned responses',
      );
    }
    const item = await this.prisma.cannedResponse.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name }),
        ...(dto.content != null && { content: dto.content }),
        ...(dto.actions != null && {
          actions: this.assertActionsAllowed(dto.actions),
        }),
      },
    });
    return item;
  }

  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.cannedResponse.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Canned response not found');
    }
    if (existing.userId !== user.id) {
      throw new ForbiddenException(
        'You can only delete your own canned responses',
      );
    }
    await this.prisma.cannedResponse.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * What this macro would say and do on this ticket — without doing any of it.
   *
   * Card 1.7's "show before you act", the same principle as card 1.28's
   * audience line: an agent sees the filled text AND the list of actions before
   * a single one runs.
   */
  async render(id: string, ticketId: string, user: AuthUser) {
    const { macro, ticket } = await this.loadForTicket(id, ticketId, user);
    const { allowed, skipped } = this.partitionActions(macro.actions);
    return {
      id: macro.id,
      name: macro.name,
      content: this.fill(macro.content, ticket, user),
      actions: allowed,
      // Named rather than hidden: a macro saved before the allowlist existed
      // should say what it will refuse to do, not quietly do less.
      skippedActions: skipped.map((action) => action.type),
    };
  }

  /**
   * Run the macro's actions on the ticket, as the person who clicked it.
   *
   * ⚠️ THIS DOES NOT POST THE MESSAGE, and that is deliberate. The rendered
   * text comes back for the composer and the agent sends it through the normal
   * `POST /tickets/:id/messages` endpoint, which is the only path that enforces
   * card 1.36's read rules, card 1.38's public/internal pin, card 1.40's reply
   * audience and card 1.42's email policy. A macro therefore CANNOT send a
   * message the composer could not send — not by re-checking those rules, but
   * by having no send path of its own to get them wrong.
   */
  async apply(id: string, ticketId: string, user: AuthUser) {
    const { macro, ticket } = await this.loadForTicket(id, ticketId, user);
    const { allowed, skipped } = this.partitionActions(macro.actions);
    const content = this.fill(macro.content, ticket, user);
    if (allowed.length === 0 && skipped.length === 0) {
      return { content, applied: 0, skippedActions: [] as string[] };
    }
    // EVERY parsed action goes to the executor, including the forbidden ones.
    // Filtering them out here would leave the execute-time gate never actually
    // exercised in production - the whole point of §2 being enforced twice is
    // that the second gate is the one a stale row meets. It reports back what
    // it refused, and that is what the caller and the audit event show.
    const result = await this.ruleEngine.applyMacroActions(
      ticketId,
      [...allowed, ...skipped] as never,
      { kind: 'macro', cannedResponseId: macro.id, actorId: user.id },
    );
    return {
      content,
      applied: result.applied,
      skippedActions: result.skipped,
    };
  }

  /**
   * Load the macro and the ticket, and refuse if this person may not use both.
   *
   * A macro is not a way round permissions (card 1.7 §4): the ticket needs
   * `canWriteTicket`, the same check the ticket's own write endpoints use. The
   * macro itself must also be one this person can see — the list is scoped to
   * their own plus their team's, so applying somebody else's private macro by
   * id is refused here rather than being possible through a guessed id.
   */
  private async loadForTicket(id: string, ticketId: string, user: AuthUser) {
    const macro = await this.prisma.cannedResponse.findUnique({
      where: { id },
    });
    if (!macro) {
      throw new NotFoundException('Canned response not found');
    }
    const isMine = macro.userId === user.id;
    const isMyTeams =
      macro.teamId != null && user.teamId != null && macro.teamId === user.teamId;
    if (!isMine && !isMyTeams) {
      throw new NotFoundException('Canned response not found');
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        displayId: true,
        subject: true,
        requesterId: true,
        assignedTeamId: true,
        assigneeId: true,
        deletedAt: true,
        requester: { select: { displayName: true, email: true } },
      },
    });
    if (!ticket || ticket.deletedAt) {
      throw new NotFoundException('Ticket not found');
    }
    if (!this.accessControl.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }
    return { macro, ticket };
  }

  /** Fill the macro's text with card 1.7 §4's variables. */
  private fill(
    content: string,
    ticket: {
      displayId: string | null;
      subject: string;
      requester: { displayName: string | null; email: string | null } | null;
    },
    user: AuthUser,
  ): string {
    return fillTemplateVars(
      content,
      buildMacroVars({
        ticket: { displayId: ticket.displayId, subject: ticket.subject },
        requester: ticket.requester,
        actor: { displayName: user.displayName, email: user.email },
      }),
    );
  }

  /**
   * Refuse to SAVE a macro carrying an action outside the allowlist.
   *
   * Card 1.7 §2. This is the first of two gates — the executor checks again on
   * every run, because a macro stored before this existed, or edited through a
   * stale client, must still not be able to send email.
   */
  private assertActionsAllowed(
    actions: { type: string }[] | undefined,
  ): Prisma.InputJsonValue {
    if (!actions || actions.length === 0) {
      return [];
    }
    const forbidden = Array.from(
      new Set(
        actions
          .map((action) => action.type)
          .filter((type) => !MACRO_ALLOWED_ACTIONS.includes(type)),
      ),
    );
    if (forbidden.length > 0) {
      throw new BadRequestException(
        `A template cannot run: ${forbidden.join(', ')}. A template may only use: ${MACRO_ALLOWED_ACTIONS.join(', ')}.`,
      );
    }
    return actions as unknown as Prisma.InputJsonValue;
  }

  /**
   * Split stored actions into the ones a macro may run and the ones it may not.
   *
   * Written defensively because this reads a Json column: a row could hold
   * anything, including a shape written before this card existed. Anything that
   * is not an object with a string `type` is discarded rather than trusted.
   */
  private partitionActions(stored: Prisma.JsonValue): {
    allowed: StoredAction[];
    skipped: StoredAction[];
  } {
    const allowed: StoredAction[] = [];
    const skipped: StoredAction[] = [];
    if (!Array.isArray(stored)) {
      return { allowed, skipped };
    }
    for (const entry of stored) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.type !== 'string') {
        continue;
      }
      const action = candidate as StoredAction;
      if (MACRO_ALLOWED_ACTIONS.includes(action.type)) {
        allowed.push(action);
      } else {
        skipped.push(action);
      }
    }
    return { allowed, skipped };
  }
}
