import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomFieldDto } from './dto/create-custom-field.dto';
import { ListCustomFieldsDto } from './dto/list-custom-fields.dto';
import { SetTicketCustomValuesDto } from './dto/set-ticket-custom-values.dto';
import { UpdateCustomFieldDto } from './dto/update-custom-field.dto';

type CustomFieldWithOptions = {
  id: string;
  name: string;
  fieldType: string;
  options: unknown;
  isRequired: boolean;
  teamId: string | null;
  categoryId: string | null;
};

function toOptionText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return '';
}

function parseOptions(raw: unknown): { value: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (item && typeof item === 'object' && 'value' in item) {
      const v = (item as { value: unknown }).value;
      const l = (item as { label?: unknown }).label;
      const value = toOptionText(v);
      const label = toOptionText(l) || value;
      return { value, label };
    }
    const s = toOptionText(item);
    return { value: s, label: s };
  });
}

@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}
  private readonly selectableFieldTypes = new Set(['DROPDOWN', 'MULTISELECT']);
  private adminAuditEventTableExists: boolean | null = null;

  private ensureOwner(user: AuthUser) {
    if (user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Owner access required');
    }
  }

  private ensureTeamAdminOrOwner(user: AuthUser, teamId: string | null) {
    if (teamId == null) {
      this.ensureOwner(user);
      return;
    }
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId)
      return;
    throw new ForbiddenException('Team admin or owner access required');
  }

  private isSelectableFieldType(fieldType: string): boolean {
    return this.selectableFieldTypes.has(fieldType);
  }

  private normalizeSelectableOptions(
    raw: unknown,
    fieldType: string,
  ): Prisma.InputJsonValue {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new BadRequestException(
        `${fieldType} fields require at least one option`,
      );
    }

    const normalized = raw.map((item, index) => {
      if (typeof item === 'string') {
        const value = item.trim();
        if (!value) {
          throw new BadRequestException(`Option ${index + 1} cannot be empty`);
        }
        return { value, label: value };
      }
      if (item && typeof item === 'object') {
        const record = item as { value?: unknown; label?: unknown };
        const value = toOptionText(record.value ?? record.label).trim();
        const label = toOptionText(record.label ?? record.value).trim();
        if (!value) {
          throw new BadRequestException(
            `Option ${index + 1} value is required`,
          );
        }
        if (!label) {
          throw new BadRequestException(
            `Option ${index + 1} label is required`,
          );
        }
        return { value, label };
      }
      throw new BadRequestException(`Option ${index + 1} is invalid`);
    });

    const seen = new Set<string>();
    for (const option of normalized) {
      const key = option.value.toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException(
          `Duplicate option value "${option.value}" is not allowed`,
        );
      }
      seen.add(key);
    }

    return normalized as unknown as Prisma.InputJsonValue;
  }

  async list(query: ListCustomFieldsDto, user: AuthUser) {
    if (user.role === UserRole.TEAM_ADMIN && !user.primaryTeamId) {
      throw new ForbiddenException(
        'Team administrator must have a primary team set',
      );
    }

    type Where = {
      teamId?: string | null;
      categoryId?: string | null;
      OR?: { teamId: string | null }[];
    };
    const where: Where = {};

    if (user.role === UserRole.OWNER || user.role === UserRole.TEAM_ADMIN) {
      const allowedTeamId =
        user.role === UserRole.TEAM_ADMIN ? user.primaryTeamId! : null;
      if (user.role === UserRole.OWNER) {
        if (query.teamId != null) where.teamId = query.teamId;
      } else {
        if (query.teamId != null && query.teamId !== allowedTeamId) {
          throw new ForbiddenException(
            'You can only list custom fields for your primary team',
          );
        }
        where.OR = [{ teamId: null }, { teamId: allowedTeamId }];
      }
      if (query.categoryId != null) where.categoryId = query.categoryId;
    } else if (user.role === UserRole.EMPLOYEE) {
      // Employees can raise tickets to any team, so allow listing
      // global fields plus the selected team's fields.
      if (query.teamId != null) {
        const team = await this.prisma.team.findUnique({
          where: { id: query.teamId },
          select: { id: true, isActive: true },
        });
        if (!team || !team.isActive) {
          throw new NotFoundException('Team not found');
        }
        where.OR = [{ teamId: null }, { teamId: query.teamId }];
      } else {
        where.teamId = null;
      }
      if (query.categoryId != null) where.categoryId = query.categoryId;
    } else {
      const allowedTeamId = user.teamId ?? null;
      if (query.teamId != null && query.teamId !== allowedTeamId) {
        throw new ForbiddenException(
          'You can only list custom fields for your own team',
        );
      }
      where.OR = [{ teamId: null }, { teamId: allowedTeamId }];
      if (query.categoryId != null) where.categoryId = query.categoryId;
    }

    const data = await this.prisma.customField.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { data };
  }

  async create(dto: CreateCustomFieldDto, user: AuthUser) {
    const teamId =
      user.role === UserRole.TEAM_ADMIN
        ? (dto.teamId ?? user.primaryTeamId ?? null)
        : (dto.teamId ?? null);
    this.ensureTeamAdminOrOwner(user, teamId);
    const isSelectable = this.isSelectableFieldType(dto.fieldType);
    if (!isSelectable && dto.options !== undefined) {
      throw new BadRequestException(
        `Options are only allowed for DROPDOWN or MULTISELECT fields`,
      );
    }
    const options = isSelectable
      ? this.normalizeSelectableOptions(dto.options, dto.fieldType)
      : undefined;

    const created = await this.prisma.customField.create({
      data: {
        name: dto.name,
        fieldType: dto.fieldType,
        options,
        isRequired: dto.isRequired ?? false,
        teamId,
        categoryId: dto.categoryId ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.recordAdminAuditEvent(
      'CUSTOM_FIELD_CREATED',
      {
        customFieldId: created.id,
        name: created.name,
        fieldType: created.fieldType,
        teamId: created.teamId,
        categoryId: created.categoryId,
        isRequired: created.isRequired,
        sortOrder: created.sortOrder,
      },
      user,
      created.teamId,
    );
    return created;
  }

  async update(id: string, dto: UpdateCustomFieldDto, user: AuthUser) {
    const existing = await this.prisma.customField.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Custom field not found');
    }
    this.ensureTeamAdminOrOwner(user, existing.teamId);
    if (dto.teamId !== undefined) {
      this.ensureTeamAdminOrOwner(user, dto.teamId ?? null);
    }
    const nextFieldType = dto.fieldType ?? existing.fieldType;
    const nextIsSelectable = this.isSelectableFieldType(nextFieldType);

    const data: Prisma.CustomFieldUpdateInput = {
      ...(dto.name != null && { name: dto.name }),
      ...(dto.fieldType != null && { fieldType: dto.fieldType }),
      ...(dto.isRequired != null && { isRequired: dto.isRequired }),
      ...(dto.sortOrder != null && { sortOrder: dto.sortOrder }),
    };

    if (nextIsSelectable) {
      if (dto.options !== undefined) {
        data.options = this.normalizeSelectableOptions(
          dto.options,
          nextFieldType,
        );
      } else if (
        dto.fieldType != null &&
        !this.isSelectableFieldType(existing.fieldType)
      ) {
        throw new BadRequestException(
          `${nextFieldType} fields require options`,
        );
      }
    } else {
      if (dto.options !== undefined && dto.options !== null) {
        throw new BadRequestException(
          `Options are only allowed for DROPDOWN or MULTISELECT fields`,
        );
      }
      if (dto.options !== undefined || dto.fieldType !== undefined) {
        data.options = Prisma.JsonNull;
      }
    }
    if (dto.teamId !== undefined) {
      data.team =
        dto.teamId == null
          ? { disconnect: true }
          : { connect: { id: dto.teamId } };
    }
    if (dto.categoryId !== undefined) {
      data.category =
        dto.categoryId == null
          ? { disconnect: true }
          : { connect: { id: dto.categoryId } };
    }
    const updated = await this.prisma.customField.update({
      where: { id },
      data,
    });
    await this.recordAdminAuditEvent(
      'CUSTOM_FIELD_UPDATED',
      {
        customFieldId: updated.id,
        name: updated.name,
        fieldType: updated.fieldType,
        teamId: updated.teamId,
        categoryId: updated.categoryId,
        isRequired: updated.isRequired,
        sortOrder: updated.sortOrder,
      },
      user,
      updated.teamId,
    );
    return updated;
  }

  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.customField.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Custom field not found');
    }
    this.ensureTeamAdminOrOwner(user, existing.teamId);

    await this.prisma.customField.delete({ where: { id } });
    await this.recordAdminAuditEvent(
      'CUSTOM_FIELD_DELETED',
      {
        customFieldId: existing.id,
        name: existing.name,
        fieldType: existing.fieldType,
        teamId: existing.teamId,
        categoryId: existing.categoryId,
      },
      user,
      existing.teamId,
    );
    return { deleted: true };
  }

  /**
   * Validates and normalizes custom field values for a ticket.
   * - When requireAllRequired: true, ensures every required field for (teamId, categoryId) is present with non-empty value.
   * - Dedupes by customFieldId (keeps last).
   * - Ensures each custom field exists and belongs to the ticket's team/category.
   * - Enforces required fields have non-empty value.
   * - Validates/coerces value by fieldType.
   * @param options.requireAllRequired - When true (e.g. ticket create), load all applicable fields and reject if any required is missing.
   * @param options.tx - When provided, run all reads inside this transaction (avoids TOCTOU).
   */
  async validateAndNormalizeValuesForTicket(
    items: { customFieldId: string; value?: string | null }[],
    teamId: string | null,
    categoryId: string | null,
    options?: { requireAllRequired?: boolean; tx?: Prisma.TransactionClient },
  ): Promise<{ customFieldId: string; value: string | null }[]> {
    const client = options?.tx ?? this.prisma;

    const deduped = new Map<string, string | null>();
    for (const item of items ?? []) {
      deduped.set(item.customFieldId, item.value ?? null);
    }

    if (options?.requireAllRequired) {
      const applicableWhere = {
        AND: [
          { OR: [{ teamId: null }, { teamId }] },
          { OR: [{ categoryId: null }, { categoryId }] },
        ],
      };
      const applicableFields = await client.customField.findMany({
        where: applicableWhere,
      });
      for (const field of applicableFields) {
        if (!field.isRequired) continue;
        const raw = deduped.get(field.id);
        const value = raw == null ? null : String(raw).trim();
        if (value === null || value === '') {
          throw new BadRequestException(
            `Required custom field "${field.name}" must be provided`,
          );
        }
      }
    }

    if (deduped.size === 0) return [];

    const ids = [...deduped.keys()];
    const fields = await client.customField.findMany({
      where: { id: { in: ids } },
    });
    const fieldMap = new Map(fields.map((f) => [f.id, f]));

    const result: { customFieldId: string; value: string | null }[] = [];
    for (const [customFieldId, rawValue] of deduped) {
      const field = fieldMap.get(customFieldId);
      if (!field) {
        throw new BadRequestException(`Unknown custom field: ${customFieldId}`);
      }
      if (field.teamId != null && field.teamId !== teamId) {
        throw new ForbiddenException(
          `Custom field "${field.name}" does not apply to this ticket's team`,
        );
      }
      if (field.categoryId != null) {
        if (categoryId === null) {
          throw new BadRequestException(
            `Category-scoped custom field "${field.name}" requires the ticket to have a category set`,
          );
        }
        if (field.categoryId !== categoryId) {
          throw new ForbiddenException(
            `Custom field "${field.name}" does not apply to this ticket's category`,
          );
        }
      }
      const value = rawValue == null ? null : String(rawValue).trim();
      if (field.isRequired && (value === null || value === '')) {
        throw new BadRequestException(
          `Required custom field "${field.name}" must have a value`,
        );
      }
      const normalized = this.normalizeValueByFieldType(
        field as CustomFieldWithOptions,
        value,
      );
      result.push({ customFieldId, value: normalized });
    }
    return result;
  }

  private normalizeValueByFieldType(
    field: CustomFieldWithOptions,
    value: string | null,
  ): string | null {
    if (value === null || value === '') return null;
    switch (field.fieldType) {
      case 'NUMBER': {
        const n = Number(value);
        if (Number.isNaN(n)) {
          throw new BadRequestException(
            `Custom field "${field.name}" must be a number`,
          );
        }
        return String(n);
      }
      case 'DATE': {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestException(
            `Custom field "${field.name}" must be a valid date`,
          );
        }
        return d.toISOString().slice(0, 10);
      }
      case 'CHECKBOX':
        return value === 'true' ||
          value === '1' ||
          value.toLowerCase() === 'yes'
          ? 'true'
          : 'false';
      case 'DROPDOWN': {
        const options = parseOptions(field.options);
        const allowed = new Set(options.map((o) => o.value));
        if (!allowed.has(value)) {
          throw new BadRequestException(
            `Custom field "${field.name}" value is not in allowed options`,
          );
        }
        return value;
      }
      case 'USER':
        return value;
      case 'MULTISELECT': {
        const options = parseOptions(field.options);
        const allowed = new Set(options.map((o) => o.value));
        const parts = value
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of parts) {
          if (!allowed.has(p)) {
            throw new BadRequestException(
              `Custom field "${field.name}" value "${p}" is not in allowed options`,
            );
          }
        }
        return parts.join(',');
      }
      default:
        return value;
    }
  }

  async setTicketValues(
    ticketId: string,
    payload: SetTicketCustomValuesDto,
    user: AuthUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { accessGrants: true },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.accessControl.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }

    await this.prisma.$transaction(async (tx) => {
      const validated = await this.validateAndNormalizeValuesForTicket(
        payload.values,
        ticket.assignedTeamId,
        ticket.categoryId,
        { tx },
      );
      for (const item of validated) {
        await tx.customFieldValue.upsert({
          where: {
            ticketId_customFieldId: {
              ticketId,
              customFieldId: item.customFieldId,
            },
          },
          create: {
            ticketId,
            customFieldId: item.customFieldId,
            value: item.value,
          },
          update: { value: item.value },
        });
      }

      if (validated.length > 0) {
        await tx.ticketEvent.create({
          data: {
            ticketId,
            type: 'CUSTOM_FIELD_UPDATED',
            payload: {
              customFieldIds: validated.map((item) => item.customFieldId),
              changedCount: validated.length,
            },
            createdById: user.id,
          },
        });
      }
    });

    return this.prisma.customFieldValue.findMany({
      where: { ticketId },
      include: { customField: true },
    });
  }

  private async recordAdminAuditEvent(
    type: string,
    payload: Record<string, unknown>,
    user: AuthUser,
    teamId: string | null,
  ) {
    const hasTable = await this.hasAdminAuditEventTable();
    if (!hasTable) return;
    // Resolve snapshot fields (8.1 fix) so audit data survives user/team deletion
    let actorName: string = user.email;
    let teamName: string | null = null;
    try {
      const [actor, team] = await Promise.all([
        this.prisma.user
          .findUnique({ where: { id: user.id }, select: { displayName: true } })
          .catch(() => null),
        teamId
          ? this.prisma.team
              .findUnique({ where: { id: teamId }, select: { name: true } })
              .catch(() => null)
          : null,
      ]);
      actorName = actor?.displayName ?? user.email;
      teamName = team?.name ?? null;
    } catch {
      /* best-effort */
    }
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "AdminAuditEvent" ("id", "type", "payload", "createdById", "teamId", "actorEmail", "actorName", "teamName", "createdAt")
        VALUES (${randomUUID()}, ${type}, ${JSON.stringify(payload)}::jsonb, ${user.id}, ${teamId}, ${user.email}, ${actorName}, ${teamName}, now())
      `;
    } catch {
      // Non-blocking audit log write
    }
  }

  private async hasAdminAuditEventTable() {
    if (this.adminAuditEventTableExists !== null) {
      return this.adminAuditEventTableExists;
    }

    try {
      const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = 'AdminAuditEvent'
        ) AS "exists"
      `;
      this.adminAuditEventTableExists = Boolean(rows[0]?.exists);
    } catch {
      this.adminAuditEventTableExists = false;
    }

    return this.adminAuditEventTableExists;
  }
}
