import { Injectable, Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
    RealtimeService,
    type TicketChangedPayload,
} from '../realtime/realtime.service';

export type TicketRealtimeReason =
    | 'ticket_created'
    | 'message_added'
    | 'assigned'
    | 'transferred'
    | 'status_changed'
    | 'priority_changed'
    | 'followers_changed'
    | 'attachment_added'
    | 'attachment_scan_status_changed'
    | 'automation_rule_executed';

@Injectable()
export class TicketRealtimeService {
    private readonly logger = new Logger(TicketRealtimeService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeService,
    ) { }

    async safeRealtime(task: () => Promise<void>) {
        try {
            await task();
        } catch (error) {
            this.logger.error(
                `Realtime publish failed: ${(error as Error).message}`,
                (error as Error).stack,
            );
        }
    }

    async emitTicketRealtimeEvent(params: {
        ticketId: string;
        reason: TicketRealtimeReason;
        actorId: string | null;
        extraTeamIds?: Array<string | null | undefined>;
        extraUserIds?: Array<string | null | undefined>;
        message?: TicketChangedPayload['message'];
    }) {
        if (!this.realtime.isEnabled()) {
            return;
        }

        const ticket = await this.prisma.ticket.findUnique({
            where: { id: params.ticketId },
            select: {
                id: true,
                status: true,
                priority: true,
                updatedAt: true,
                assignedTeamId: true,
                assignedTeam: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                requesterId: true,
                assigneeId: true,
                assignee: {
                    select: {
                        id: true,
                        email: true,
                        displayName: true,
                    },
                },
                followers: {
                    select: {
                        userId: true,
                    },
                },
            },
        });

        if (!ticket) {
            return;
        }

        const actor =
            params.actorId == null
                ? null
                : await this.prisma.user.findUnique({
                    where: { id: params.actorId },
                    select: {
                        id: true,
                        email: true,
                        displayName: true,
                    },
                });

        const teamIds = [
            ticket.assignedTeamId,
            ...(params.extraTeamIds ?? []),
        ].filter((teamId): teamId is string => Boolean(teamId));
        const userIds = [
            ticket.requesterId,
            ticket.assigneeId,
            params.actorId,
            ...ticket.followers.map((follower) => follower.userId),
            ...(params.extraUserIds ?? []),
        ].filter((userId): userId is string => Boolean(userId));

        await this.realtime.publishTicketChanged(
            {
                ticketId: ticket.id,
                reason: params.reason,
                actorId: params.actorId,
                status: ticket.status,
                priority: ticket.priority,
                updatedAt: ticket.updatedAt.toISOString(),
                assignedTeamId: ticket.assignedTeamId,
                assignedTeam: ticket.assignedTeam,
                assigneeId: ticket.assigneeId,
                assignee: ticket.assignee,
                followerCount: ticket.followers.length,
                actor,
                message: params.message,
            },
            { teamIds, userIds },
        );
    }

    toRealtimeMessagePayload(message: {
        id: string;
        body: string;
        type: MessageType;
        createdAt: Date;
        author: {
            id: string;
            email: string;
            displayName: string;
        };
    }): NonNullable<TicketChangedPayload['message']> {
        return {
            id: message.id,
            body: message.body,
            type: message.type,
            createdAt: message.createdAt.toISOString(),
            author: {
                id: message.author.id,
                email: message.author.email,
                displayName: message.author.displayName,
            },
        };
    }

    async publishAutomationRealtimeUpdate(
        ticketId: string,
        actorId: string | null,
    ) {
        await this.safeRealtime(() =>
            this.emitTicketRealtimeEvent({
                ticketId,
                reason: 'automation_rule_executed',
                actorId,
            }),
        );
    }

    async publishTicketTyping(
        ...args: Parameters<RealtimeService['publishTicketTyping']>
    ) {
        return this.realtime.publishTicketTyping(...args);
    }

    isEnabled() {
        return this.realtime.isEnabled();
    }
}
