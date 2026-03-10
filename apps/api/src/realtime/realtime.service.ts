import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { WebPubSubServiceClient } from '@azure/web-pubsub';
import type { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { parsePositiveInt } from '../common/config.utils';

type RealtimeEnvelope<Payload extends Record<string, unknown>> = {
  event: string;
  occurredAt: string;
  payload: Payload;
};

export type RealtimeNegotiationResponse = {
  enabled: boolean;
  hub: string | null;
  url: string | null;
  groups: string[];
};

export type TicketChangedPayload = {
  ticketId: string;
  reason: string;
  actorId: string | null;
  status: string;
  priority: string;
  updatedAt: string;
  assignedTeamId: string | null;
  assignedTeam: {
    id: string;
    name: string;
  } | null;
  assigneeId: string | null;
  assignee: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  followerCount: number;
  actor: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  message?: {
    id: string;
    body: string;
    type: string;
    createdAt: string;
    author: {
      id: string;
      email: string;
      displayName: string;
    };
  } | null;
};

export type TicketTypingPayload = {
  ticketId: string;
  actorId: string;
  actorDisplayName: string;
  actorEmail: string;
  isTyping: boolean;
};

export type AdminChangedPayload = {
  scope: string;
  action: string;
  entityId: string | null;
  teamId: string | null;
  actorId: string | null;
};

export type AdminChangedAudience = {
  teamIds?: string[];
  allScopedTeams?: boolean;
};

type TicketChangedAudience = {
  userIds: string[];
};

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly hubName: string;
  private readonly tokenLifetimeMinutes: number;
  private readonly client: WebPubSubServiceClient | null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.hubName =
      this.config.get<string>('AZURE_WEB_PUBSUB_HUB') || 'ticketing';
    this.tokenLifetimeMinutes = parsePositiveInt(
      this.config.get<string>('AZURE_WEB_PUBSUB_TOKEN_LIFETIME_MINUTES'),
      60,
    );
    const connectionString =
      this.config.get<string>('AZURE_WEB_PUBSUB_CONNECTION_STRING')?.trim() ||
      '';

    if (!connectionString) {
      this.client = null;
      this.logger.log(
        'Realtime transport disabled (missing AZURE_WEB_PUBSUB_CONNECTION_STRING).',
      );
      return;
    }

    try {
      this.client = new WebPubSubServiceClient(connectionString, this.hubName);
    } catch (error) {
      this.client = null;
      this.logger.error(
        'Failed to initialize Azure Web PubSub client; realtime is disabled.',
        (error as Error).stack,
      );
    }
  }

  isEnabled() {
    return this.client !== null;
  }

  async negotiateForUser(user: AuthUser): Promise<RealtimeNegotiationResponse> {
    if (!this.client) {
      return {
        enabled: false,
        hub: null,
        url: null,
        groups: [],
      };
    }

    const groups = this.resolveGroupsForUser(user);
    try {
      const token = await this.client.getClientAccessToken({
        userId: user.id,
        groups,
        expirationTimeInMinutes: this.tokenLifetimeMinutes,
      });
      return {
        enabled: true,
        hub: this.hubName,
        url: token.url,
        groups,
      };
    } catch (error) {
      this.logger.error(
        `Failed to negotiate realtime token for user ${user.id}.`,
        (error as Error).stack,
      );
      return {
        enabled: false,
        hub: this.hubName,
        url: null,
        groups: [],
      };
    }
  }

  async publishNotificationsUpdated(
    userId: string,
    payload: {
      reason: string;
      unreadCount: number;
    },
  ) {
    await this.publishUserEvent(userId, 'notifications.updated', payload);
  }

  async publishTicketChanged(
    payload: TicketChangedPayload,
    audience: TicketChangedAudience,
  ) {
    await this.publishTicketEventToAudience(
      'ticket.changed',
      payload,
      audience,
    );
  }

  async publishTicketTyping(
    payload: TicketTypingPayload,
    audience: TicketChangedAudience,
  ) {
    await this.publishTicketEventToAudience('ticket.typing', payload, audience);
  }

  async publishAdminChanged(
    payload: AdminChangedPayload,
    audience: AdminChangedAudience = {},
  ) {
    if (!this.client) {
      return;
    }

    const envelope = this.buildEnvelope('admin.changed', payload);
    const groupNames = await this.resolveAdminAudienceGroups(payload, audience);

    await Promise.all(
      groupNames.map((groupName) =>
        this.safeSend(`group:${groupName}`, () =>
          this.client!.group(groupName).sendToAll(envelope),
        ),
      ),
    );
  }

  async publishUserEvent<Payload extends Record<string, unknown>>(
    userId: string,
    event: string,
    payload: Payload,
  ) {
    if (!this.client) {
      return;
    }

    const envelope = this.buildEnvelope(event, payload);
    await this.safeSend(`user:${userId}`, () =>
      this.client!.sendToUser(userId, envelope),
    );
  }

  private resolveGroupsForUser(user: AuthUser): string[] {
    const groups: string[] = [];
    if (user.role === UserRole.OWNER) {
      groups.push(this.ownerGroupName());
    }
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      groups.push(this.teamAdminGroupName(user.primaryTeamId));
    }
    if (user.role === UserRole.LEAD && user.teamId) {
      groups.push(this.leadGroupName(user.teamId));
    }
    return this.uniqueNonEmpty(groups);
  }

  private ownerGroupName() {
    return 'role:owner';
  }

  private teamAdminGroupName(teamId: string) {
    return `role:team-admin:${teamId}`;
  }

  private leadGroupName(teamId: string) {
    return `role:lead:${teamId}`;
  }

  private buildEnvelope<Payload extends Record<string, unknown>>(
    event: string,
    payload: Payload,
  ): RealtimeEnvelope<Payload> {
    return {
      event,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  private uniqueNonEmpty(values: Array<string | null | undefined>) {
    return [
      ...new Set(
        values.filter((value): value is string => Boolean(value?.trim())),
      ),
    ];
  }

  private async safeSend(target: string, task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      this.logger.warn(`Realtime publish failed for ${target}.`);
      this.logger.debug((error as Error).stack);
    }
  }

  private async resolveActiveTeamIds() {
    try {
      const teams = await this.prisma.team.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      return teams.map((team) => team.id);
    } catch (error) {
      this.logger.warn(
        'Failed to resolve active teams for admin.changed publish.',
      );
      this.logger.debug((error as Error).stack);
      return [] as string[];
    }
  }

  private resolveAudienceTeamIds(
    payload: AdminChangedPayload,
    audience: AdminChangedAudience,
  ) {
    return this.uniqueNonEmpty([payload.teamId, ...(audience.teamIds ?? [])]);
  }

  private ownerAndTeamAdminGroups(teamIds: string[]) {
    return this.uniqueNonEmpty([
      this.ownerGroupName(),
      ...teamIds.map((teamId) => this.teamAdminGroupName(teamId)),
    ]);
  }

  private ownerAndLeadAndTeamAdminGroups(teamIds: string[]) {
    return this.uniqueNonEmpty([
      this.ownerGroupName(),
      ...teamIds.map((teamId) => this.teamAdminGroupName(teamId)),
      ...teamIds.map((teamId) => this.leadGroupName(teamId)),
    ]);
  }

  private async ownerAndAllTeamAdminGroups() {
    return this.ownerAndTeamAdminGroups(await this.resolveActiveTeamIds());
  }

  private async ownerAndAllLeadAndTeamAdminGroups() {
    return this.ownerAndLeadAndTeamAdminGroups(
      await this.resolveActiveTeamIds(),
    );
  }

  private async resolveAdminAudienceGroups(
    payload: AdminChangedPayload,
    audience: AdminChangedAudience,
  ) {
    const explicitTeamIds = this.resolveAudienceTeamIds(payload, audience);

    switch (payload.scope) {
      case 'automation_rule':
      case 'routing_rule':
        return this.ownerAndTeamAdminGroups(explicitTeamIds);
      case 'custom_field':
        return explicitTeamIds.length > 0
          ? this.ownerAndTeamAdminGroups(explicitTeamIds)
          : this.ownerAndAllTeamAdminGroups();
      case 'category':
        return this.ownerAndAllTeamAdminGroups();
      case 'team':
        if (payload.action === 'created') {
          return [this.ownerGroupName()];
        }
        return this.ownerAndLeadAndTeamAdminGroups(explicitTeamIds);
      case 'team_member':
        return this.ownerAndLeadAndTeamAdminGroups(explicitTeamIds);
      case 'sla_business_hours':
        return this.ownerAndAllLeadAndTeamAdminGroups();
      case 'sla_policy':
        return this.resolveSlaPolicyAudienceGroups(payload, audience);
      default:
        return [this.ownerGroupName()];
    }
  }

  private async resolveSlaPolicyAudienceGroups(
    payload: AdminChangedPayload,
    audience: AdminChangedAudience,
  ) {
    if (audience.allScopedTeams) {
      return this.ownerAndAllLeadAndTeamAdminGroups();
    }

    const explicitTeamIds = this.resolveAudienceTeamIds(payload, audience);
    if (explicitTeamIds.length > 0) {
      return this.ownerAndLeadAndTeamAdminGroups(explicitTeamIds);
    }

    if (!payload.entityId) {
      return [this.ownerGroupName()];
    }

    try {
      const policy = await this.prisma.slaPolicyConfig.findUnique({
        where: { id: payload.entityId },
        select: {
          isDefault: true,
          assignments: {
            select: { teamId: true },
          },
        },
      });
      if (!policy) {
        return [this.ownerGroupName()];
      }
      if (policy.isDefault) {
        return this.ownerAndAllLeadAndTeamAdminGroups();
      }
      const teamIds = policy.assignments.map((assignment) => assignment.teamId);
      return teamIds.length > 0
        ? this.ownerAndLeadAndTeamAdminGroups(teamIds)
        : [this.ownerGroupName()];
    } catch (error) {
      this.logger.warn(
        `Failed to resolve SLA policy audience for realtime publish ${payload.entityId}.`,
      );
      this.logger.debug((error as Error).stack);
      return [this.ownerGroupName()];
    }
  }

  private async publishTicketEventToAudience<
    Payload extends Record<string, unknown>,
  >(event: string, payload: Payload, audience: TicketChangedAudience) {
    if (!this.client) {
      return;
    }

    const envelope = this.buildEnvelope(event, payload);
    const uniqueUserIds = this.uniqueNonEmpty(audience.userIds);

    const tasks: Array<Promise<void>> = [];

    // Ticket-scoped events are user-targeted only. Team groups are too coarse
    // for agent visibility rules, but owners can still receive the shared feed.
    tasks.push(
      this.safeSend(`group:${this.ownerGroupName()}`, () =>
        this.client!.group(this.ownerGroupName()).sendToAll(envelope),
      ),
    );

    for (const userId of uniqueUserIds) {
      tasks.push(
        this.safeSend(`user:${userId}`, () =>
          this.client!.sendToUser(userId, envelope),
        ),
      );
    }

    await Promise.all(tasks);
  }
}
