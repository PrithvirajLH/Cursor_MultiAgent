import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
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
    // `canWrite` is computed HERE, by the same rule the write routes enforce,
    // so the editor can hide a control it would be refused rather than
    // re-deriving the rule in the browser. Card 1.7 was cleaning up exactly
    // that kind of duplicated rule when it deleted the client-side
    // substitution; adding a second copy of the permission would repeat it.
    const team =
      user.teamId != null
        ? await this.prisma.team.findUnique({
            where: { id: user.teamId },
            select: { id: true, name: true },
          })
        : null;
    return {
      data: items.map((item) => ({
        ...item,
        canWrite: this.mayWrite(item, user),
        // Separate from canWrite on purpose: a LEAD may write their team's
        // shared template but is not its author, and only the author may
        // change who it is shared with.
        isMine: item.userId === user.id,
      })),
      // The one team this person may share with. The editor offers this or
      // nothing, because anything else is now a 400.
      team,
    };
  }

  /** Who may change a template: its author, a lead of the owning team, an OWNER. */
  private mayWrite(
    macro: { userId: string | null; teamId: string | null },
    user: AuthUser,
  ): boolean {
    if (macro.userId === user.id) {
      return true;
    }
    if (user.role === UserRole.OWNER) {
      return true;
    }
    // A private template is its author's alone - a lead has no business in
    // somebody's unfinished drafts.
    if (macro.teamId == null) {
      return false;
    }
    return (
      (user.role === UserRole.LEAD || user.role === UserRole.TEAM_ADMIN) &&
      user.teamId === macro.teamId
    );
  }

  async create(dto: CreateCannedResponseDto, user: AuthUser) {
    const actions = this.assertActionsAllowed(dto.actions);
    const teamId = this.assertTeamIsMine(dto.teamId, user);
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
    const existing = await this.loadWritable(id, user, 'edit');
    void existing;
    const item = await this.prisma.cannedResponse.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name }),
        ...(dto.content != null && { content: dto.content }),
        ...(dto.actions != null && {
          actions: this.assertActionsAllowed(dto.actions),
        }),
        ...(dto.teamId !== undefined && {
          teamId: this.assertMayReshare(existing, dto.teamId, user),
        }),
      },
    });
    return item;
  }

  async delete(id: string, user: AuthUser) {
    await this.loadWritable(id, user, 'delete');
    await this.prisma.cannedResponse.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * A template may only be shared with a team the caller is actually in.
   *
   * REFUSES rather than demotes (card 1.7b §3b). This used to keep the id only
   * when it matched the caller's team and quietly write `null` otherwise - so
   * "share this with HR" from an IT agent returned 201 and became a private
   * template. Somebody would eventually announce a team template that only they
   * could see.
   */
  private assertTeamIsMine(
    teamId: string | undefined,
    user: AuthUser,
  ): string | null {
    if (teamId == null) {
      return null;
    }
    if (user.teamId == null || teamId !== user.teamId) {
      throw new BadRequestException(
        'You can only share a template with your own team',
      );
    }
    return teamId;
  }

  /**
   * Who a template is shared with is the AUTHOR's decision, not a lead's.
   *
   * A lead may maintain their team's shared template - fix its wording, correct
   * an action - because otherwise it freezes when its author leaves. But
   * un-sharing one would hide it from the team (and from the lead), and sharing
   * somebody's private draft would publish work they had not finished. Neither
   * is a maintenance job, so both stay with the person whose template it is.
   *
   * The target team is still checked: an author may only share with a team they
   * are actually in, exactly as on create.
   */
  private assertMayReshare(
    existing: { userId: string | null; teamId: string | null },
    teamId: string | null,
    user: AuthUser,
  ): string | null {
    if (existing.userId !== user.id) {
      throw new ForbiddenException(
        'Only the author can change who a template is shared with',
      );
    }
    if (teamId === null) {
      return null;
    }
    return this.assertTeamIsMine(teamId, user);
  }

  /**
   * Load a template this person may change, or say why not.
   *
   * Card 1.7b §3c. Before this card only the AUTHOR could edit, which froze a
   * shared template the moment its author left, went on holiday or changed team
   * - and since card 1.7 a template also changes ticket state, so a typo in one
   * is no longer only cosmetic.
   *
   * The three outcomes are deliberate:
   *   * cannot even SEE it        -> 404, never 403. A 403 confirms the id is
   *                                  real, which is the rule card 1.7 set for
   *                                  somebody else's private template.
   *   * can see, cannot write     -> 403. An agent looking at a teammate's
   *                                  shared template.
   *   * author, or a lead/admin of the owning team, or an OWNER -> allowed.
   *
   * A PRIVATE template stays its author's alone. A lead has no business in
   * somebody's unfinished drafts, so `teamId === null` grants nobody else
   * anything - not even sight of it.
   */
  private async loadWritable(id: string, user: AuthUser, verb: string) {
    const existing = await this.prisma.cannedResponse.findUnique({
      where: { id },
    });
    const isMine = existing?.userId === user.id;
    const isMyTeams =
      existing?.teamId != null &&
      user.teamId != null &&
      existing.teamId === user.teamId;
    if (!existing || (!isMine && !isMyTeams && user.role !== UserRole.OWNER)) {
      throw new NotFoundException('Canned response not found');
    }
    if (!this.mayWrite(existing, user)) {
      throw new ForbiddenException(
        `Only the author, or a lead of the owning team, can ${verb} this template`,
      );
    }
    return existing;
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
