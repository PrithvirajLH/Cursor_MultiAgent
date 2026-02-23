import { Injectable } from '@nestjs/common';
import { IdempotencyRequest, IdempotencyState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type IdempotencyScope = {
  key: string;
  method: string;
  route: string;
  actorId: string;
};

@Injectable()
export class IdempotencyService {
  private lastCleanupAtMs = 0;
  private readonly cleanupIntervalMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async find(scope: IdempotencyScope) {
    await this.cleanupExpired();
    return this.prisma.idempotencyRequest.findUnique({
      where: {
        key_method_route_actorId: {
          key: scope.key,
          method: scope.method,
          route: scope.route,
          actorId: scope.actorId,
        },
      },
    });
  }

  async reserve(scope: IdempotencyScope, requestHash: string, ttlMs: number) {
    await this.cleanupExpired();
    const expiresAt = new Date(Date.now() + ttlMs);
    return this.prisma.idempotencyRequest.create({
      data: {
        key: scope.key,
        method: scope.method,
        route: scope.route,
        actorId: scope.actorId,
        requestHash,
        state: IdempotencyState.IN_PROGRESS,
        expiresAt,
      },
    });
  }

  async markCompleted(
    id: string,
    statusCode: number,
    responseBody: unknown,
  ): Promise<IdempotencyRequest> {
    return this.prisma.idempotencyRequest.update({
      where: { id },
      data: {
        state: IdempotencyState.COMPLETED,
        statusCode,
        responseBody: this.toJsonValue(responseBody),
      },
    });
  }

  async release(id: string) {
    await this.prisma.idempotencyRequest.delete({ where: { id } }).catch(() => {
      // no-op: if the reservation was already cleared, retries can proceed.
    });
  }

  private toJsonValue(
    value: unknown,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === undefined) {
      return Prisma.JsonNull;
    }
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      return Prisma.JsonNull;
    }
  }

  private async cleanupExpired() {
    const now = Date.now();
    if (now - this.lastCleanupAtMs < this.cleanupIntervalMs) {
      return;
    }
    this.lastCleanupAtMs = now;
    await this.prisma.idempotencyRequest.deleteMany({
      where: { expiresAt: { lt: new Date(now) } },
    });
  }
}
