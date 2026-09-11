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
    const viewType = dto.viewType ?? 'tickets';
    const view = await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await this.clearOtherDefaults(tx, user.id, viewType);
      }
      return tx.savedView.create({
        data: {
          name: dto.name,
          filters: dto.filters as object,
          isDefault,
          viewType,
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
    // A view does not change kind on an edit unless the caller says so; a
    // rename must not silently move a report view into the tickets namespace
    // and take that default with it.
    const nextViewType = dto.viewType ?? existing.viewType;
    const view = await this.prisma.$transaction(async (tx) => {
      if (nextDefault && !existing.isDefault) {
        await this.clearOtherDefaults(tx, user.id, nextViewType);
      }
      return tx.savedView.update({
        where: { id },
        data: {
          ...(dto.name != null && { name: dto.name }),
          ...(dto.filters != null && { filters: dto.filters as object }),
          isDefault: nextDefault,
          viewType: nextViewType,
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
   * Returns the ids only. They are code constants from the web app - since
   * card 1.61, from `SAVED_VIEWS` AND `SYSTEM_VIEWS`, which share this one
   * array as a single namespace. The server neither validates them against a
   * list nor cares whether they still exist: a stale id is ignored by the
   * reader, so retiring a row needs no cleanup here.
   *
   * That the server validates nothing is why card 1.61 needed no API change at
   * all - three new hideable ids were already storable.
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
   * Clear this user's other defaults OF THE SAME KIND before setting a new one.
   *
   * ⚠️ CARD 1.53 ASKED FOR THIS AND CARD 1.60 DELIVERED IT; the note that
   * used to sit here explained why it could not be done, and that reasoning is
   * worth keeping because it was correct at the time.
   *
   * The bug: making a REPORT view your default also cleared your default TICKET
   * view, because both kinds share this table and this `updateMany` spanned
   * them. 1.53's implementer scoped it per kind, got
   * `Unique constraint failed on the fields: (userId)`, and backed it out -
   * because the database enforced the same rule one level down:
   *
   *     CREATE UNIQUE INDEX "SavedView_default_per_user"
   *       ON "SavedView" ("userId")
   *       WHERE "isDefault" = true AND "userId" IS NOT NULL;
   *
   * ONE DEFAULT PER USER was a database invariant, not a service choice, so
   * scoping here alone converted a working flow into a 500. Backing it out was
   * right.
   *
   * They also warned that putting the discriminator into SQL would make a
   * second copy of a rule already living in TypeScript - the drift behind cards
   * 1.36, 1.38, 1.47 and 1.50. That objection is why migration 61 STRIPS
   * `viewType` out of `filters` rather than leaving it in both places: there is
   * one discriminator, and it is the column.
   *
   * Migration 61 replaces that index with the same guarantee keyed on
   * `(userId, viewType)`, so this clear is now scoped to match it exactly. The
   * service and the index must keep agreeing: widening one without the other
   * brings back either the cross-kind clobber or the 500.
   */
  private async clearOtherDefaults(
    tx: Prisma.TransactionClient,
    userId: string,
    viewType: string,
  ): Promise<void> {
    await tx.savedView.updateMany({
      where: { userId, isDefault: true, viewType },
      data: { isDefault: false },
    });
  }
}
