import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Announcement,
  AnnouncementAudience,
  Prisma,
  UserRole,
} from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { activeAnnouncementWhere } from './active-announcement-where.util';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

/** What the banner needs, and nothing it does not. */
export type ActiveAnnouncementView = {
  id: string;
  title: string;
  body: string;
  severity: Announcement['severity'];
  linkedTicketId: string | null;
  endsAt: string | null;
};

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * What this viewer should see right now (card 2.7).
   *
   * Runs on every page load for every signed-in user, so it returns a narrow
   * projection rather than whole rows, ordered so the loudest thing is first.
   *
   * The filter — including the team boundary — is `activeAnnouncementWhere`.
   * See that file: it is the security rule of this card and there is one copy.
   *
   * @param user The signed-in viewer.
   * @returns Active announcements visible to them, most severe first.
   */
  async listActive(user: AuthUser): Promise<ActiveAnnouncementView[]> {
    const rows = await this.prisma.announcement.findMany({
      where: activeAnnouncementWhere(
        new Date(),
        this.accessControl.operationalTeamIds(user),
      ),
      select: {
        id: true,
        title: true,
        body: true,
        severity: true,
        linkedTicketId: true,
        endsAt: true,
        startsAt: true,
      },
      orderBy: [{ severity: 'desc' }, { startsAt: 'desc' }],
    });
    // `severity: desc` is alphabetical on the enum's storage order, which is
    // INFO, WARNING, OUTAGE - so descending happens to put WARNING above INFO
    // but not OUTAGE above both. Sorted explicitly here instead of trusting
    // that coincidence, because "the outage is at the top" is the whole point.
    const rank: Record<string, number> = { OUTAGE: 0, WARNING: 1, INFO: 2 };
    return rows
      .slice()
      .sort(
        (a, b) =>
          (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) ||
          b.startsAt.getTime() - a.startsAt.getTime(),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        severity: row.severity,
        linkedTicketId: row.linkedTicketId,
        endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      }));
  }

  /**
   * Everything an admin may manage, expired ones included (card 2.7).
   *
   * ⚠️ A TEAM_ADMIN SEES THEIR OWN TEAM'S ANNOUNCEMENTS AND THE GLOBAL ONES,
   * not another team's. The admin screen is a wider window than the banner, not
   * an unlocked one.
   */
  async list(user: AuthUser): Promise<Announcement[]> {
    const where: Prisma.AnnouncementWhereInput =
      user.role === UserRole.OWNER
        ? {}
        : {
            OR: [
              { audience: AnnouncementAudience.ALL },
              { teamId: { in: this.adminTeamIds(user) } },
            ],
          };
    return this.prisma.announcement.findMany({
      where,
      orderBy: [{ startsAt: 'desc' }],
    });
  }

  /**
   * Post an announcement (card 2.7).
   *
   * ⚠️ AN `audience: ALL` ANNOUNCEMENT IS OWNER-ONLY. A TEAM_ADMIN may only
   * speak to their own team — otherwise one team's administrator can put a
   * banner on everybody's screen, which is the same shape of mistake as a
   * client-side audience filter.
   */
  async create(
    dto: CreateAnnouncementDto,
    user: AuthUser,
  ): Promise<Announcement> {
    const audience = dto.audience ?? AnnouncementAudience.ALL;
    const teamId = this.resolveTeamId(audience, dto.teamId ?? null, user);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    this.assertWindow(startsAt, endsAt);
    await this.assertLinkedTicketExists(dto.linkedTicketId ?? null);
    return this.prisma.announcement.create({
      data: {
        title: dto.title,
        body: dto.body,
        severity: dto.severity ?? undefined,
        audience,
        teamId,
        linkedTicketId: dto.linkedTicketId ?? null,
        startsAt,
        endsAt,
        createdById: user.id,
      },
    });
  }

  /** Edit one, including ending it early by setting `endsAt`. */
  async update(
    id: string,
    dto: UpdateAnnouncementDto,
    user: AuthUser,
  ): Promise<Announcement> {
    const existing = await this.loadForWrite(id, user);
    const audience = dto.audience ?? existing.audience;
    const nextTeamId =
      dto.teamId !== undefined ? dto.teamId : existing.teamId;
    const teamId = this.resolveTeamId(audience, nextTeamId, user);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt =
      dto.endsAt === undefined
        ? existing.endsAt
        : dto.endsAt === null
          ? null
          : new Date(dto.endsAt);
    this.assertWindow(startsAt, endsAt);
    if (dto.linkedTicketId) {
      await this.assertLinkedTicketExists(dto.linkedTicketId);
    }
    return this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title,
        body: dto.body,
        severity: dto.severity,
        audience,
        teamId,
        linkedTicketId:
          dto.linkedTicketId === undefined ? undefined : dto.linkedTicketId,
        startsAt,
        endsAt,
      },
    });
  }

  /** Remove one outright. Ending it early is usually the better answer. */
  async remove(id: string, user: AuthUser): Promise<{ id: string }> {
    await this.loadForWrite(id, user);
    await this.prisma.announcement.delete({ where: { id } });
    return { id };
  }

  /** The teams a TEAM_ADMIN administers. Their primary team, by house rule. */
  private adminTeamIds(user: AuthUser): string[] {
    return user.primaryTeamId ? [user.primaryTeamId] : [];
  }

  /**
   * Decide the team column, and refuse the combinations that would leak.
   *
   * `ALL` carries no team; `TEAM` must carry one, and for a TEAM_ADMIN it must
   * be theirs. An OWNER may address any team.
   */
  private resolveTeamId(
    audience: AnnouncementAudience,
    teamId: string | null,
    user: AuthUser,
  ): string | null {
    if (audience === AnnouncementAudience.ALL) {
      if (user.role !== UserRole.OWNER) {
        throw new ForbiddenException(
          'Only an owner can announce to everyone; use a team announcement',
        );
      }
      return null;
    }
    if (!teamId) {
      throw new BadRequestException(
        'A team announcement needs a team',
      );
    }
    if (user.role !== UserRole.OWNER && !this.adminTeamIds(user).includes(teamId)) {
      throw new ForbiddenException(
        'You can only announce to your own team',
      );
    }
    return teamId;
  }

  /** A window that has already closed would be invisible the moment it saved. */
  private assertWindow(startsAt: Date, endsAt: Date | null): void {
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('startsAt is not a valid date');
    }
    if (endsAt && Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('endsAt is not a valid date');
    }
    if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException(
        'An announcement that ends before it starts would never be seen',
      );
    }
  }

  /** A dangling link would render a banner pointing at nothing. */
  private async assertLinkedTicketExists(
    linkedTicketId: string | null,
  ): Promise<void> {
    if (!linkedTicketId) {
      return;
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: linkedTicketId },
      select: { id: true },
    });
    if (!ticket) {
      throw new BadRequestException('Linked ticket not found');
    }
  }

  /** Load one and check the caller may write it, or 404/403 accordingly. */
  private async loadForWrite(
    id: string,
    user: AuthUser,
  ): Promise<Announcement> {
    const existing = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Announcement not found');
    }
    if (user.role === UserRole.OWNER) {
      return existing;
    }
    // A TEAM_ADMIN may edit their own team's, and never a global one - the
    // mirror of the create rule, or ALL announcements would be editable by
    // anyone who could not have made one.
    if (
      existing.audience === AnnouncementAudience.ALL ||
      !existing.teamId ||
      !this.adminTeamIds(user).includes(existing.teamId)
    ) {
      throw new ForbiddenException(
        'You can only manage your own team announcements',
      );
    }
    return existing;
  }
}
