import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, SavedView } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { UpdateSavedViewDto } from './dto/update-saved-view.dto';
import { canManageTeamViews } from './can-manage-team-views.util';

@Injectable()
export class SavedViewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every view this user can see: their own, plus their team's.
   *
   * ⚠️ Uses the single resolved `teamId`, so a MULTI-TEAM member sees only
   * their PRIMARY team's views. `AuthUser.memberTeamIds` carries the full set
   * and is deliberately not used here: unioning would surface views from teams
   * whose sidebar this person does not work out of. Card 1.53 kept the existing
   * behaviour rather than changing visibility as a side effect.
   */
  async list(user: AuthUser) {
    const orConditions: Array<{ userId: string } | { teamId: string }> = [
      { userId: user.id },
    ];
    if (user.teamId) {
      orConditions.push({ teamId: user.teamId });
    }
    const views = await this.prisma.savedView.findMany({
      where: { OR: orConditions },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return { data: views };
  }

  /**
   * Create a personal view, or - for a team admin - a team-wide one.
   *
   * ⚠️ CARD 1.53 ADDED THE ROLE GATE THAT WAS MISSING ENTIRELY. `dto.teamId`
   * used to be honoured whenever it matched the caller's own team with no role
   * check, so any user could publish a view into every colleague's sidebar.
   */
  async create(dto: CreateSavedViewDto, user: AuthUser) {
    const teamId = this.resolveTeamId(dto.teamId ?? null, user);
    const isDefault = this.resolveDefault(dto.isDefault ?? false, teamId);
    const view = await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await this.clearOtherDefaults(tx, user.id);
      }
      return tx.savedView.create({
        data: {
          name: dto.name,
          filters: dto.filters as object,
          isDefault,
          userId: user.id,
          teamId,
        },
      });
    });
    return view;
  }

  /**
   * Edit a view, including promoting a personal view to the team and back.
   *
   * ⚠️ A TEAM VIEW IS NO LONGER EDITABLE BY ITS CREATOR ALONE. The old check
   * was `existing.userId !== user.id`, so a second team admin could not touch
   * it and it was orphaned the day that person left.
   */
  async update(id: string, dto: UpdateSavedViewDto, user: AuthUser) {
    const existing = await this.prisma.savedView.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Saved view not found');
    }
    this.assertCanWrite(existing, user);
    // `teamId` is only re-resolved when the caller actually sent it, so an
    // ordinary rename cannot silently demote a team view to a personal one.
    const nextTeamId =
      dto.teamId === undefined
        ? existing.teamId
        : this.resolveTeamId(dto.teamId, user);
    const nextDefault =
      dto.isDefault === undefined
        ? this.resolveDefault(existing.isDefault, nextTeamId)
        : this.resolveDefault(dto.isDefault, nextTeamId);
    const view = await this.prisma.$transaction(async (tx) => {
      if (nextDefault && !existing.isDefault) {
        await this.clearOtherDefaults(tx, user.id);
      }
      return tx.savedView.update({
        where: { id },
        data: {
          ...(dto.name != null && { name: dto.name }),
          ...(dto.filters != null && { filters: dto.filters as object }),
          isDefault: nextDefault,
          teamId: nextTeamId,
        },
      });
    });
    return view;
  }

  /** Delete a view the caller owns, or a team view they administer. */
  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.savedView.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Saved view not found');
    }
    this.assertCanWrite(existing, user);
    await this.prisma.savedView.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * The built-in presets this user's team has switched off (card 1.53).
   *
   * Returns the ids only. They are code constants from the web app's
   * `SAVED_VIEWS`, so the server neither validates them against a list nor
   * cares whether they still exist - a stale id is ignored by the reader.
   */
  async listHiddenPresets(user: AuthUser) {
    if (!user.teamId) {
      return { data: [] as string[] };
    }
    const team = await this.prisma.team.findUnique({
      where: { id: user.teamId },
      select: { hiddenPresetIds: true },
    });
    return { data: team?.hiddenPresetIds ?? [] };
  }

  /**
   * Replace the hidden-preset list for a team. Team admins and owners only.
   *
   * A whole-list PUT rather than add/remove calls, because the UI is a set of
   * checkboxes: sending the resulting set is one round trip and cannot drift
   * from what the admin is looking at.
   */
  async setHiddenPresets(teamId: string, presetIds: string[], user: AuthUser) {
    if (!canManageTeamViews(user, teamId)) {
      throw new ForbiddenException(
        'Only a team admin or an owner can change which presets a team sees',
      );
    }
    const unique = [...new Set(presetIds.filter((id) => id.trim() !== ''))];
    const team = await this.prisma.team.update({
      where: { id: teamId },
      data: { hiddenPresetIds: unique },
      select: { hiddenPresetIds: true },
    });
    return { data: team.hiddenPresetIds };
  }

  /**
   * Who may write this row.
   *
   * A personal view: its owner. A team view: any admin of that team, or an
   * owner. Deliberately NOT "its creator", which is what orphaned team views.
   */
  private assertCanWrite(view: SavedView, user: AuthUser): void {
    if (view.teamId) {
      if (!canManageTeamViews(user, view.teamId)) {
        throw new ForbiddenException(
          'Only a team admin or an owner can change a team saved view',
        );
      }
      return;
    }
    if (view.userId !== user.id) {
      throw new ForbiddenException('You can only edit your own saved views');
    }
  }

  /** Validate a requested `teamId` against the caller's role. */
  private resolveTeamId(teamId: string | null, user: AuthUser): string | null {
    if (teamId == null) {
      return null;
    }
    if (!canManageTeamViews(user, teamId)) {
      throw new ForbiddenException(
        'Only a team admin or an owner can create a team saved view',
      );
    }
    return teamId;
  }

  /**
   * ⚠️ `isDefault` is strictly PERSONAL and never allowed on a team view.
   *
   * A team default would be a three-way fight between the team's choice, the
   * member's own default and whatever they last opened. A team admin who wants
   * everyone to land somewhere is asking for a team landing view, which is a
   * different feature nobody has requested.
   */
  private resolveDefault(isDefault: boolean, teamId: string | null): boolean {
    if (isDefault && teamId) {
      throw new BadRequestException(
        'A team saved view cannot be a personal default',
      );
    }
    return isDefault;
  }

  /**
   * Clear this user's other defaults before setting a new one.
   *
   * ⚠️ CARD 1.53 ASKED FOR THIS TO BE SCOPED PER VIEW KIND, AND IT CANNOT BE.
   *
   * The card records a live bug: making a REPORT view the default also clears
   * the default TICKET view, because both kinds share this table and this
   * `updateMany` spans them. That is real. But the fix is not available at this
   * layer, because the database enforces the same rule one level down:
   *
   *     CREATE UNIQUE INDEX "SavedView_default_per_user"
   *       ON "SavedView" ("userId")
   *       WHERE "isDefault" = true AND "userId" IS NOT NULL;
   *
   * -- migration 20260213140000_schema_hardening, which predates the
   * `viewType` discriminator that split reports from tickets.
   *
   * So ONE DEFAULT PER USER is a database invariant, not a service choice.
   * Scoping this clear to one kind makes the second default violate that index
   * and the request 500s - it converts a working flow into an error, which is
   * strictly worse than the behaviour being complained about. Verified: doing
   * exactly that produced
   * `Unique constraint failed on the fields: (userId)`.
   *
   * Fixing it properly means replacing that index with one keyed on the user
   * AND the kind, which is a second schema change this batch does not allow -
   * and it would put the JSON discriminator into SQL as a second copy of a rule
   * that already lives in TypeScript, which is the drift behind cards 1.36,
   * 1.38, 1.47 and 1.50. Reported rather than improvised.
   */
  private async clearOtherDefaults(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.savedView.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }
}
