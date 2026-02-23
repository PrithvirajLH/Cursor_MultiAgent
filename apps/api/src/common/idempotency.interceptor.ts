import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyRequest, IdempotencyState, Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { AuthRequest } from '../auth/current-user.decorator';
import { IdempotencyScope, IdempotencyService } from './idempotency.service';

const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type BeginResult =
  | { mode: 'execute'; reservationId: string }
  | { mode: 'replay'; statusCode: number; responseBody: unknown };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request & AuthRequest>();
    const response = http.getResponse<Response>();
    const method = request.method.toUpperCase();

    if (!IDEMPOTENT_METHODS.has(method)) {
      return next.handle();
    }

    const key = this.readIdempotencyKey(request.headers['idempotency-key']);
    if (!key) {
      return next.handle();
    }
    if (key.length > 128) {
      throw new BadRequestException(
        'Idempotency-Key must be 128 characters or fewer',
      );
    }

    const scope: IdempotencyScope = {
      key,
      method,
      route: this.routeKey(request),
      actorId: this.resolveActorScope(request),
    };
    const requestHash = this.hashRequest(request.body);

    return from(this.begin(scope, requestHash)).pipe(
      mergeMap((beginResult) => {
        if (beginResult.mode === 'replay') {
          response.status(beginResult.statusCode);
          response.setHeader('Idempotency-Replayed', 'true');
          return of(beginResult.responseBody);
        }

        return next.handle().pipe(
          mergeMap((body: unknown) =>
            from(
              this.idempotency.markCompleted(
                beginResult.reservationId,
                this.normalizeStatusCode(response.statusCode),
                body,
              ),
            ).pipe(map(() => body)),
          ),
          catchError((error: unknown) =>
            from(this.idempotency.release(beginResult.reservationId)).pipe(
              mergeMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }

  private async begin(
    scope: IdempotencyScope,
    requestHash: string,
  ): Promise<BeginResult> {
    const existing = await this.idempotency.find(scope);
    if (existing) {
      return this.resolveExisting(existing, requestHash);
    }

    try {
      const reserved = await this.idempotency.reserve(
        scope,
        requestHash,
        this.idempotencyTtlMs(),
      );
      return { mode: 'execute', reservationId: reserved.id };
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
      const raced = await this.idempotency.find(scope);
      if (!raced) {
        throw error;
      }
      return this.resolveExisting(raced, requestHash);
    }
  }

  private resolveExisting(
    existing: IdempotencyRequest,
    requestHash: string,
  ): BeginResult {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different request payload',
      );
    }
    if (existing.state === IdempotencyState.IN_PROGRESS) {
      throw new ConflictException(
        'A request with this Idempotency-Key is still processing',
      );
    }

    return {
      mode: 'replay',
      statusCode: this.normalizeStatusCode(existing.statusCode),
      responseBody: existing.responseBody ?? null,
    };
  }

  private readIdempotencyKey(
    value: string | string[] | undefined,
  ): string | null {
    const key = Array.isArray(value) ? value[0] : value;
    if (key == null) return null;
    const normalized = key.trim();
    if (!normalized) {
      throw new BadRequestException('Idempotency-Key header cannot be empty');
    }
    return normalized;
  }

  private routeKey(request: Request) {
    const pathWithoutQuery = request.originalUrl.split('?')[0] ?? request.path;
    return pathWithoutQuery || request.path;
  }

  private resolveActorScope(request: Request & AuthRequest) {
    if (request.user?.id) {
      return request.user.id;
    }

    const forwardedForRaw = this.readHeaderValue(
      request.headers['x-forwarded-for'],
    );
    const forwardedFor = forwardedForRaw.split(',')[0]?.trim() ?? '';
    const seed = [
      request.ip ?? '',
      forwardedFor,
      this.readHeaderValue(request.headers['user-agent']),
      this.readHeaderValue(request.headers['x-attachment-scan-secret']),
      this.readHeaderValue(request.headers['x-inbound-email-secret']),
    ].join('|');
    const digest = createHash('sha256').update(seed).digest('hex').slice(0, 24);
    return `anonymous:${digest}`;
  }

  private readHeaderValue(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value) ?? '';
  }

  private hashRequest(body: unknown) {
    const normalized = this.stableStringify(body ?? null);
    return createHash('sha256').update(normalized).digest('hex');
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortValue(value));
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.sortValue(entry));
    }
    if (value && typeof value === 'object') {
      const asRecord = value as Record<string, unknown>;
      const sortedKeys = Object.keys(asRecord).sort();
      const sorted: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        sorted[key] = this.sortValue(asRecord[key]);
      }
      return sorted;
    }
    return value;
  }

  private idempotencyTtlMs() {
    const configured = Number.parseInt(
      this.config.get<string>('IDEMPOTENCY_TTL_MS') ?? '',
      10,
    );
    if (Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return 24 * 60 * 60 * 1000;
  }

  private normalizeStatusCode(statusCode: number | null | undefined) {
    if (!statusCode || !Number.isFinite(statusCode) || statusCode < 100) {
      return 200;
    }
    return statusCode;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
