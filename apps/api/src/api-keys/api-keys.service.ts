import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { apiKeyHashMatches, generateApiKey, hashApiKey } from './api-key.util';

/** What an admin screen may know about a key. Never the key itself. */
export interface ApiKeySummary {
  id: string;
  name: string;
  serviceUserId: string;
  serviceUserEmail: string;
  teamScope: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** A newly minted key, the one and only time the secret is visible. */
export interface IssuedApiKey extends ApiKeySummary {
  /** ⚠️ Shown once. Not stored, not recoverable, never logged. */
  key: string;
}

/** What the auth guard needs to turn a presented key into an identity. */
export interface ResolvedApiKey {
  id: string;
  serviceUserId: string;
  teamScope: string | null;
}

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issue a key bound to an existing service user (card 2.6).
   *
   * The key inherits that user's role and memberships; there is no separate
   * permission model, which is the whole point — `roleFilter` and
   * `accessConditionSql` keep working unchanged for a machine caller.
   */
  async create(input: {
    name: string;
    serviceUserId: string;
    teamScope?: string | null;
  }): Promise<IssuedApiKey> {
    const serviceUser = await this.prisma.user.findUnique({
      where: { id: input.serviceUserId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!serviceUser) {
      throw new NotFoundException('Service user not found');
    }
    if (!serviceUser.isActive) {
      throw new BadRequestException('Service user is deactivated');
    }
    // ⚠️ An OWNER key would be a machine credential that can do anything a
    // person can, including issuing more keys. Refused on purpose.
    if (serviceUser.role === UserRole.OWNER) {
      throw new BadRequestException(
        'A key cannot be issued for an owner account',
      );
    }
    if (input.teamScope) {
      const member = await this.prisma.teamMember.findFirst({
        where: { userId: serviceUser.id, teamId: input.teamScope },
        select: { id: true },
      });
      // A scope the service user is not in would silently grant nothing, which
      // looks like a broken key rather than a rejected one.
      if (!member) {
        throw new BadRequestException(
          'The service user is not a member of the scoped team',
        );
      }
    }
    const key = generateApiKey();
    const row = await this.prisma.apiKey.create({
      data: {
        name: input.name,
        hashedKey: hashApiKey(key),
        serviceUserId: serviceUser.id,
        teamScope: input.teamScope ?? null,
      },
    });
    return {
      id: row.id,
      name: row.name,
      serviceUserId: row.serviceUserId,
      serviceUserEmail: serviceUser.email,
      teamScope: row.teamScope,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      key,
    };
  }

  /** Every key, live and revoked. Never includes the secret. */
  async list(): Promise<ApiKeySummary[]> {
    const rows = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      include: { serviceUser: { select: { email: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      serviceUserId: row.serviceUserId,
      serviceUserEmail: row.serviceUser.email,
      teamScope: row.teamScope,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Revoke a key.
   *
   * ⚠️ Takes effect on the very next request, because `resolve` reads the row
   * every time and nothing caches it. Revocation that waits for a TTL is not
   * revocation.
   */
  async revoke(id: string): Promise<{ id: string; revokedAt: Date }> {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('API key not found');
    }
    if (existing.revokedAt) {
      return { id: existing.id, revokedAt: existing.revokedAt };
    }
    const row = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { id: row.id, revokedAt: row.revokedAt as Date };
  }

  /**
   * Turn a presented key into the identity it stands for, or null.
   *
   * ⚠️ NO CACHE, BY DESIGN. One indexed read per authenticated request is the
   * price of a revocation that bites immediately, and the card asks for exactly
   * that. `lastUsedAt` is updated as a side effect so an admin can see which
   * keys are actually in use before revoking one.
   */
  async resolve(presented: string): Promise<ResolvedApiKey | null> {
    if (!presented) {
      return null;
    }
    const hashed = hashApiKey(presented);
    const row = await this.prisma.apiKey.findUnique({
      where: { hashedKey: hashed },
      select: {
        id: true,
        hashedKey: true,
        serviceUserId: true,
        teamScope: true,
        revokedAt: true,
      },
    });
    if (!row || row.revokedAt) {
      return null;
    }
    // The unique index already found it; this confirms the match without a
    // comparison that could leak timing, as intake.service.ts does.
    if (!apiKeyHashMatches(row.hashedKey, hashed)) {
      return null;
    }
    await this.prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return {
      id: row.id,
      serviceUserId: row.serviceUserId,
      teamScope: row.teamScope,
    };
  }
}
