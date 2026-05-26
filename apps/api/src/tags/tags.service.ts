import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TagSource, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';

const MAX_TAG_LENGTH = 50;
const MIN_TAG_LENGTH = 1;
const TAG_REGEX = /^[a-z0-9][a-z0-9 _.\-/]*$/;

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * Normalize a user-supplied tag string. Trim, lowercase, collapse internal
   * whitespace. Throws if the result is empty or violates the format.
   */
  normalize(raw: string): string {
    const value = (raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (value.length < MIN_TAG_LENGTH) {
      throw new BadRequestException('Tag cannot be empty');
    }
    if (value.length > MAX_TAG_LENGTH) {
      throw new BadRequestException(
        `Tag is too long (max ${MAX_TAG_LENGTH} characters)`,
      );
    }
    if (!TAG_REGEX.test(value)) {
      throw new BadRequestException(
        'Tag must start with a letter or number and only contain letters, numbers, spaces, dots, dashes, underscores, or slashes',
      );
    }
    return value;
  }

  async autocomplete(q: string | undefined, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const where = q
      ? { name: { contains: q.toLowerCase(), mode: 'insensitive' as const } }
      : {};
    const tags = await this.prisma.tag.findMany({
      where,
      include: { _count: { select: { ticketTags: true } } },
      orderBy: [{ ticketTags: { _count: 'desc' } }, { name: 'asc' }],
      take: safeLimit,
    });
    return tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      ticketCount: t._count.ticketTags,
    }));
  }

  async listAllForAdmin(actor: AuthUser) {
    if (
      actor.role !== UserRole.OWNER &&
      actor.role !== UserRole.TEAM_ADMIN
    ) {
      throw new ForbiddenException('Only admins can view tags');
    }

    if (actor.role === UserRole.TEAM_ADMIN) {
      const teamId = actor.primaryTeamId;
      if (!teamId) return [];
      const tags = await this.prisma.tag.findMany({
        where: {
          ticketTags: {
            some: { ticket: { assignedTeamId: teamId } },
          },
        },
        include: {
          ticketTags: {
            where: { ticket: { assignedTeamId: teamId } },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          },
        },
        orderBy: { name: 'asc' },
      });
      return tags
        .map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          ticketCount: t.ticketTags.length,
          lastUsedAt: t.ticketTags[0]?.createdAt ?? null,
          createdAt: t.createdAt,
        }))
        .sort((a, b) =>
          b.ticketCount === a.ticketCount
            ? a.name.localeCompare(b.name)
            : b.ticketCount - a.ticketCount,
        );
    }

    const tags = await this.prisma.tag.findMany({
      include: {
        _count: { select: { ticketTags: true } },
        ticketTags: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
      orderBy: [{ ticketTags: { _count: 'desc' } }, { name: 'asc' }],
    });
    return tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      ticketCount: t._count.ticketTags,
      lastUsedAt: t.ticketTags[0]?.createdAt ?? null,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Internal: attach a list of tag names to a ticket. Skips access-control
   * (caller is trusted) and is safe to call inside an existing transaction
   * by passing `tx`. Used by TicketsService.create and the AI pipeline.
   */
  async attachManyToTicket(
    ticketId: string,
    rawNames: readonly string[],
    source: TagSource,
    createdById: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!rawNames?.length) return;
    const client = tx ?? this.prisma;
    const seen = new Set<string>();
    const names: string[] = [];
    for (const raw of rawNames) {
      let normalized: string;
      try {
        normalized = this.normalize(raw);
      } catch {
        continue; // silently drop garbage; UI is the source of truth for validation
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      names.push(normalized);
    }
    if (!names.length) return;

    for (const name of names) {
      const tag = await client.tag.upsert({
        where: { name },
        update: {},
        create: { name, createdById: createdById ?? undefined },
      });
      await client.ticketTag.upsert({
        where: { ticketId_tagId: { ticketId, tagId: tag.id } },
        update: {},
        create: {
          ticketId,
          tagId: tag.id,
          source,
          createdById: createdById ?? undefined,
        },
      });
    }
  }

  async addToTicket(
    ticketId: string,
    rawName: string,
    user: AuthUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        requesterId: true,
        assignedTeamId: true,
        assigneeId: true,
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (!this.accessControl.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }

    const name = this.normalize(rawName);
    const tag = await this.prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name, createdById: user.id },
    });

    await this.prisma.ticketTag.upsert({
      where: { ticketId_tagId: { ticketId, tagId: tag.id } },
      update: {}, // already attached — no-op (preserve original source)
      create: {
        ticketId,
        tagId: tag.id,
        source: TagSource.MANUAL,
        createdById: user.id,
      },
    });

    return { id: tag.id, name: tag.name, color: tag.color };
  }

  async removeFromTicket(
    ticketId: string,
    tagId: string,
    user: AuthUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        requesterId: true,
        assignedTeamId: true,
        assigneeId: true,
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (!this.accessControl.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }
    await this.prisma.ticketTag
      .delete({ where: { ticketId_tagId: { ticketId, tagId } } })
      .catch(() => undefined); // already gone — idempotent
    return { ok: true };
  }

  async rename(tagId: string, rawName: string, actor: AuthUser) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can rename tags');
    }
    const target = await this.prisma.tag.findUnique({ where: { id: tagId } });
    if (!target) throw new NotFoundException('Tag not found');
    const name = this.normalize(rawName);
    if (name === target.name) return target;
    const collision = await this.prisma.tag.findUnique({ where: { name } });
    if (collision && collision.id !== tagId) {
      throw new ConflictException(
        'Another tag with that name already exists. Use merge instead.',
      );
    }
    return this.prisma.tag.update({ where: { id: tagId }, data: { name } });
  }

  /**
   * Merge `fromIds` into `intoId`. All TicketTag rows referencing the source
   * tags are re-pointed at the target (conflicts dropped — a ticket already
   * has the target). Source tags are then deleted.
   */
  async merge(fromIds: string[], intoId: string, actor: AuthUser) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can merge tags');
    }
    if (!fromIds.length) {
      throw new BadRequestException('Provide at least one tag to merge from');
    }
    if (fromIds.includes(intoId)) {
      throw new BadRequestException(
        'Target tag cannot also appear in fromIds',
      );
    }

    const target = await this.prisma.tag.findUnique({ where: { id: intoId } });
    if (!target) throw new NotFoundException('Target tag not found');

    return this.prisma.$transaction(async (tx) => {
      // Tickets already tagged with the target — to avoid PK conflicts we
      // delete the source rows on those tickets entirely.
      const targetTickets = await tx.ticketTag.findMany({
        where: { tagId: intoId },
        select: { ticketId: true },
      });
      const targetTicketIds = new Set(targetTickets.map((r) => r.ticketId));

      // Drop source rows on tickets that already have the target.
      if (targetTicketIds.size > 0) {
        await tx.ticketTag.deleteMany({
          where: {
            tagId: { in: fromIds },
            ticketId: { in: Array.from(targetTicketIds) },
          },
        });
      }

      // Re-point the rest to the target.
      const moved = await tx.ticketTag.updateMany({
        where: { tagId: { in: fromIds } },
        data: { tagId: intoId },
      });

      const deleted = await tx.tag.deleteMany({
        where: { id: { in: fromIds } },
      });

      return { ok: true, movedRows: moved.count, deletedTags: deleted.count };
    });
  }

  /**
   * Create a tag without attaching it to any ticket (admin-only). Useful for
   * pre-seeding a taxonomy. If the tag already exists, return it (idempotent).
   */
  async createStandalone(rawName: string, actor: AuthUser) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can create tags here');
    }
    const name = this.normalize(rawName);
    const tag = await this.prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name, createdById: actor.id },
    });
    return { id: tag.id, name: tag.name, color: tag.color };
  }

  async deleteTag(tagId: string, actor: AuthUser) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can delete tags');
    }
    const count = await this.prisma.ticketTag.count({ where: { tagId } });
    if (count > 0) {
      throw new BadRequestException(
        `Tag is attached to ${count} ticket(s). Remove or merge first.`,
      );
    }
    await this.prisma.tag.delete({ where: { id: tagId } });
    return { ok: true };
  }
}
