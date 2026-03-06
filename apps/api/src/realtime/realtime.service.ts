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

type TicketChangedAudience = {
  teamIds: string[];
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

    const groups = await this.resolveGroupsForUser(user);
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

  async publishAdminChanged(payload: AdminChangedPayload) {
    if (!this.client) {
      return;
    }

    const envelope = this.buildEnvelope('admin.changed', payload);
    const activeTeamIds = await this.resolveActiveTeamIds();
    const tasks: Array<Promise<void>> = [];

    for (const teamId of activeTeamIds) {
      tasks.push(
        this.safeSend(`group:${this.teamGroupName(teamId)}`, () =>
          this.client!.group(this.teamGroupName(teamId)).sendToAll(envelope),
        ),
      );
    }

    tasks.push(
      this.safeSend(`group:${this.ownerGroupName()}`, () =>
        this.client!.group(this.ownerGroupName()).sendToAll(envelope),
      ),
    );

    await Promise.all(tasks);
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

  private async resolveGroupsForUser(user: AuthUser): Promise<string[]> {
    const teamIds = new Set<string>();
    if (user.teamId) {
      teamIds.add(user.teamId);
    }
    if (user.primaryTeamId) {
      teamIds.add(user.primaryTeamId);
    }

    try {
      const memberships = await this.prisma.teamMember.findMany({
        where: { userId: user.id },
        select: { teamId: true },
      });
      for (const membership of memberships) {
        if (membership.teamId) {
          teamIds.add(membership.teamId);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to load team memberships for realtime groups on user ${user.id}.`,
      );
      this.logger.debug((error as Error).stack);
    }

    const groups = Array.from(teamIds).map((teamId) =>
      this.teamGroupName(teamId),
    );
    if (user.role === UserRole.OWNER) {
      groups.push(this.ownerGroupName());
    }
    return this.uniqueNonEmpty(groups);
  }

  private teamGroupName(teamId: string) {
    return `team:${teamId}`;
  }

  private ownerGroupName() {
    return 'role:owner';
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

  private async publishTicketEventToAudience<
    Payload extends Record<string, unknown>,
  >(event: string, payload: Payload, audience: TicketChangedAudience) {
    if (!this.client) {
      return;
    }

    const envelope = this.buildEnvelope(event, payload);
    const uniqueTeamIds = this.uniqueNonEmpty(audience.teamIds);
    const uniqueUserIds = this.uniqueNonEmpty(audience.userIds);

    const tasks: Array<Promise<void>> = [];

    for (const teamId of uniqueTeamIds) {
      tasks.push(
        this.safeSend(`group:${this.teamGroupName(teamId)}`, () =>
          this.client!.group(this.teamGroupName(teamId)).sendToAll(envelope),
        ),
      );
    }

    // Owners can see all tickets, so keep their dashboards in sync.
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
