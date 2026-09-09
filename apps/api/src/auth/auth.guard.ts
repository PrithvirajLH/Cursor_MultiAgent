import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TeamRole, UserRole, type User } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DuplicateAccountService } from '../common/duplicate-account.service';
import { getRequestId } from '../common/request-context';
import {
  UserIdentityService,
  type DirectoryAddress,
} from '../common/user-identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { joseRejectionDetail } from './jose-rejection-detail.util';
import { AuthRequest } from './current-user.decorator';

type JwtClaims = {
  sub?: string;
  /**
   * The Entra directory object id: tenant-wide and stable for a human.
   *
   * NOT `sub`. `sub` is a pairwise subject, scoped per application, so the same
   * person arriving through a different client presents a different value - it
   * would look like it worked and quietly fail to match. `oid` is the id in the
   * directory, and the same value Graph returns as `/me.id`.
   */
  oid?: string;
  email?: string;
  preferred_username?: string;
  upn?: string;
  name?: string;
  department?: string;
  office_location?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
};

type AuthIdentity = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
  department: string | null;
  location: string | null;
  provisionIfMissing: boolean;
  /** The `oid` claim, when the token carried one. Null everywhere else. */
  entraObjectId?: string | null;
  /** Every address the token presented, for UserIdentityService to record. */
  directoryAddresses?: DirectoryAddress[];
};

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private azureJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private azureJwksIssuer: string | null = null;
  private bootstrapOwnerEmails: Set<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly duplicateAccounts: DuplicateAccountService,
    private readonly userIdentity: UserIdentityService,
  ) {}

  /**
   * Record WHY a request was rejected, then build the 401 to throw (card 1.54).
   *
   * ⚠️ THIS GUARD HAS TWENTY DISTINCT REJECTION PATHS AND THE LOG RECORDED
   * `statusCode: 401` FOR ALL OF THEM. On 2026-09-09 the owner hit eleven 401s
   * in a single 70 ms burst and nothing in a whole day of container log could
   * say whether the token had expired, been signed by the wrong key, or carried
   * the wrong audience. Every rejection now names itself.
   *
   * Every line starts with the literal `AUTH_REJECT`, because the person who
   * needs it is reading a 2 MB log at 3 a.m. and needs one string to grep. The
   * `requestId` is the same correlation id `correlation-id.middleware` puts on
   * the `Request completed … 401` line, so the reason and the route join up.
   *
   * ⚠️ **`detail` must never carry the bearer token or a decoded payload.** An
   * id_token is a credential and this log ships to Kudu. Pass the claim you
   * CHECKED (`exp`, `iss`, `aud`) — never the whole set, never the token. The
   * accompanying spec asserts the token is absent from the output, which is
   * what stops a future "just log the payload while we debug this" change.
   *
   * @param reason The message returned to the caller, and the grep key.
   * @param detail Safe, named scalars only — claim names and checked values.
   * @returns The exception to throw, so a call site reads `throw this.reject(…)`.
   */
  private reject(
    reason: string,
    detail?: Record<string, unknown>,
  ): UnauthorizedException {
    const parts = [
      'AUTH_REJECT',
      `reason=${JSON.stringify(reason)}`,
      `requestId=${getRequestId() ?? 'none'}`,
    ];
    for (const [key, value] of Object.entries(detail ?? {})) {
      if (value === undefined || value === null) {
        continue;
      }
      parts.push(`${key}=${JSON.stringify(value)}`);
    }
    this.logger.warn(parts.join(' '));
    return new UnauthorizedException(reason);
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    const authIdentity = token
      ? await this.identityFromBearerToken(token)
      : this.identityFromInsecureHeaders(
          request.headers['x-user-id'],
          request.headers['x-user-email'],
        );

    if (!authIdentity) {
      throw this.reject('Missing authentication credentials');
    }

    const user = authIdentity.provisionIfMissing
      ? await this.findOrProvisionUser(authIdentity)
      : await this.findExistingUser(authIdentity);

    if (!user) {
      throw this.reject('Unknown user');
    }

    let membership =
      user.primaryTeamId != null
        ? await this.prisma.teamMember.findFirst({
            where: { userId: user.id, teamId: user.primaryTeamId },
            include: { team: true },
          })
        : null;

    if (!membership) {
      const preferredRole =
        user.role === UserRole.LEAD
          ? TeamRole.LEAD
          : user.role === UserRole.AGENT
            ? TeamRole.AGENT
            : user.role === UserRole.TEAM_ADMIN
              ? TeamRole.ADMIN
              : null;

      if (preferredRole) {
        membership = await this.prisma.teamMember.findFirst({
          where: { userId: user.id, role: preferredRole },
          include: { team: true },
          orderBy: { createdAt: 'asc' },
        });
      }
    }

    if (!membership) {
      membership = await this.prisma.teamMember.findFirst({
        where: { userId: user.id },
        include: { team: true },
        orderBy: { createdAt: 'asc' },
      });
    }

    const resolvedTeamId = membership?.teamId ?? user.primaryTeamId ?? null;

    const membershipRows = await this.prisma.teamMember.findMany({
      where: { userId: user.id },
      select: { teamId: true },
      orderBy: { createdAt: 'asc' },
    });
    const memberTeamIds = [...new Set(membershipRows.map((row) => row.teamId))];

    request.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      teamId: resolvedTeamId,
      teamName: membership?.team?.name ?? null,
      teamRole: membership?.role ?? null,
      primaryTeamId: user.primaryTeamId ?? null,
      memberTeamIds,
    };

    return true;
  }

  private identityFromInsecureHeaders(
    userIdHeader: string | string[] | undefined,
    emailHeader: string | string[] | undefined,
  ): AuthIdentity | null {
    if (!this.shouldAllowInsecureHeaders()) {
      throw this.reject('Bearer token is required');
    }

    const userId = this.singleHeaderValue(userIdHeader);
    const email = this.normalizeEmail(this.singleHeaderValue(emailHeader));

    if (!userId && !email) {
      return null;
    }

    return {
      userId,
      email,
      displayName: null,
      department: null,
      location: null,
      provisionIfMissing: false,
    };
  }

  private shouldAllowInsecureHeaders() {
    // Read this security-sensitive flag live from process.env (falling back to
    // ConfigService) so a permissive value is never cached at boot and the guard
    // always reflects the current environment — consistent with the NODE_ENV read below.
    const configured =
      process.env.AUTH_ALLOW_INSECURE_HEADERS ??
      this.config.get<string>('AUTH_ALLOW_INSECURE_HEADERS');
    if (configured !== 'true') {
      return false;
    }
    const nodeEnv = (
      this.config.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      ''
    ).toLowerCase();
    return nodeEnv !== 'production';
  }

  private async identityFromBearerToken(token: string): Promise<AuthIdentity> {
    const algorithm = this.getTokenAlgorithm(token);
    const secret = this.config.get<string>('AUTH_JWT_SECRET');
    if (algorithm === 'HS256') {
      if (!secret) {
        throw this.reject('HS256 auth is not configured');
      }

      const claims = this.verifyHs256Jwt(token, secret);
      this.validateRegisteredClaims(claims);

      const userId = typeof claims.sub === 'string' ? claims.sub : null;
      const email = this.normalizeEmail(
        this.firstStringClaim(claims, ['email']),
      );

      if (!userId && !email) {
        throw this.reject('Token must include sub or email claim');
      }

      return {
        userId,
        email,
        displayName: this.firstStringClaim(claims, ['name']),
        department: null,
        location: null,
        provisionIfMissing: false,
      };
    }

    const claims = await this.verifyAzureJwt(token);
    // Every address form the token presented, kept rather than thrown away.
    // Entra gives a UPN and a `mail` that routinely differ, and the second one
    // is what appears on a sent email or a Power Automate form response - which
    // is where the duplicate account came from.
    const directoryAddresses: DirectoryAddress[] = [];
    for (const source of ['preferred_username', 'upn', 'email'] as const) {
      const value = this.normalizeEmail(this.firstStringClaim(claims, [source]));
      if (value) directoryAddresses.push({ email: value, source });
    }
    return {
      userId: null,
      email: this.normalizeEmail(
        this.firstStringClaim(claims, ['preferred_username', 'upn', 'email']),
      ),
      displayName: this.firstStringClaim(claims, ['name']),
      department: this.firstStringClaim(claims, ['department']),
      location: this.firstStringClaim(claims, ['office_location']),
      provisionIfMissing: true,
      entraObjectId: this.firstStringClaim(claims, ['oid']),
      directoryAddresses,
    };
  }

  private async verifyAzureJwt(token: string): Promise<JwtClaims> {
    const tenantId = this.config.get<string>('AZURE_TENANT_ID');
    const clientId = this.config.get<string>('AZURE_CLIENT_ID');
    if (!tenantId || !clientId) {
      throw this.reject('Azure auth is not configured');
    }

    const defaultIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    const defaultJwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
    const issuer = this.config.get<string>('AUTH_JWT_ISSUER') ?? defaultIssuer;
    const jwksUri = this.config.get<string>('AUTH_JWKS_URI') ?? defaultJwksUri;
    const jwks = this.getAzureJwks(issuer, jwksUri);

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: clientId,
        algorithms: ['RS256'],
      });
      return payload as JwtClaims;
    } catch (err: unknown) {
      // ⚠️ CARD 1.54, THE PRODUCTION PATH. This catch used to swallow every
      // distinguishable cause into one message. Production is Azure/RS256 only,
      // and `validateRegisteredClaims` - the only code that can say
      // 'Token expired' - runs solely on the HS256 branch, so an expired
      // production token and a forged one were the same log line. `jose` knew
      // which it was all along; `joseRejectionDetail` lifts its `code` out.
      // The RESPONSE stays deliberately vague: the caller learns nothing new.
      throw this.reject('Invalid bearer token', {
        stage: 'azure-verify',
        ...joseRejectionDetail(err),
      });
    }
  }

  private getAzureJwks(issuer: string, jwksUri: string) {
    if (this.azureJwks && this.azureJwksIssuer === issuer) {
      return this.azureJwks;
    }
    try {
      this.azureJwks = createRemoteJWKSet(new URL(jwksUri));
      this.azureJwksIssuer = issuer;
      return this.azureJwks;
    } catch {
      throw this.reject('Invalid Azure JWKS configuration');
    }
  }

  private async findOrProvisionUser(identity: AuthIdentity) {
    const email = this.normalizeEmail(identity.email);
    if (!email) {
      throw this.reject('Token must include email claim');
    }

    const shouldBootstrapOwner = this.shouldBootstrapOwner(email);
    const entraObjectId = identity.entraObjectId?.trim() || null;

    // The directory object first, because it is the thing that does not change.
    // A token with no `oid` skips straight to the address lookup and behaves
    // exactly as it did before this card - Easy Auth and the dev header path
    // must not regress.
    const byObject = entraObjectId
      ? await this.prisma.user.findUnique({ where: { entraObjectId } })
      : null;
    if (byObject) {
      // The address on this token may differ from the one stored. It is NOT
      // overwritten and no second row is made: the row is the human, and the
      // address is one of their labels. The alternate form is recorded below
      // instead, which is what teaches intake and inbound email about it.
      await this.recordDirectoryAddresses(byObject.id, identity);
      return this.applyProfileUpdates(byObject, identity, email, {
        stampObjectId: null,
      });
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    const displayName = identity.displayName?.trim() || email;
    const provisionedRole = shouldBootstrapOwner
      ? UserRole.OWNER
      : UserRole.EMPLOYEE;

    if (!existing) {
      const created = await this.prisma.user.create({
        data: {
          email,
          displayName,
          role: provisionedRole,
          department: identity.department,
          location: identity.location,
          entraObjectId,
        },
      });
      await this.recordDirectoryAddresses(created.id, identity);
      // Card 1.30: say so if this looks like a second account for somebody we
      // already have. After the create, never before - flagging must not be
      // able to stop a user being provisioned.
      await this.duplicateAccounts.flag(created.email, created.role);
      return created;
    }

    // Matched on the address. If the token brought a directory id and this row
    // has none, stamp it - that is how the existing accounts acquire their
    // identity, quietly, as people log in. No manual step and no backfill.
    await this.recordDirectoryAddresses(existing.id, identity);
    return this.applyProfileUpdates(existing, identity, email, {
      stampObjectId: existing.entraObjectId ? null : entraObjectId,
    });
  }

  /**
   * The profile fields a token may refresh, plus an optional identity stamp.
   *
   * `email` is deliberately NOT among them. A human resolved by directory
   * object can present a different address form on any given token - Entra
   * hands out a UPN and a `mail` that routinely differ - and overwriting the
   * stored address on each login would make the row flap between the two. The
   * alternate form is recorded as an alias instead.
   */
  private async applyProfileUpdates(
    user: User,
    identity: AuthIdentity,
    email: string,
    options: { stampObjectId: string | null },
  ) {
    const displayName = identity.displayName?.trim() || email;
    const updateData: {
      displayName?: string;
      department?: string | null;
      location?: string | null;
      role?: UserRole;
      entraObjectId?: string;
    } = {};
    if (user.displayName !== displayName) {
      updateData.displayName = displayName;
    }
    if (identity.department !== null && user.department !== identity.department) {
      updateData.department = identity.department;
    }
    if (identity.location !== null && user.location !== identity.location) {
      updateData.location = identity.location;
    }
    if (this.shouldBootstrapOwner(email) && user.role !== UserRole.OWNER) {
      updateData.role = UserRole.OWNER;
    }
    if (options.stampObjectId) {
      updateData.entraObjectId = options.stampObjectId;
    }

    if (Object.keys(updateData).length === 0) {
      return user;
    }

    return this.prisma.user
      .update({ where: { id: user.id }, data: updateData })
      .catch((error) => {
        // The only field here that can collide is entraObjectId, and only if
        // another row already claims it. A login must not fail over a stamp.
        this.logger.warn(
          `Could not update user ${user.id} from the token: ${(error as Error).message}`,
        );
        return user;
      });
  }

  /**
   * Hand the token's addresses to UserIdentityService.
   *
   * Best-effort and awaited: it never throws, and a login must not fail because
   * a convenience mapping could not be written.
   */
  private async recordDirectoryAddresses(
    userId: string,
    identity: AuthIdentity,
  ) {
    const addresses = identity.directoryAddresses ?? [];
    if (addresses.length === 0) return;
    await this.userIdentity.recordAddresses(userId, addresses);
  }

  private shouldBootstrapOwner(email: string) {
    return this.getBootstrapOwnerEmails().has(email);
  }

  private getBootstrapOwnerEmails() {
    if (this.bootstrapOwnerEmails) {
      return this.bootstrapOwnerEmails;
    }

    const configured =
      this.config.get<string>('AUTH_BOOTSTRAP_OWNER_EMAILS') ?? '';
    const parsed = configured
      .split(',')
      .map((value) => this.normalizeEmail(value))
      .filter((value): value is string => value !== null);
    this.bootstrapOwnerEmails = new Set(parsed);
    return this.bootstrapOwnerEmails;
  }

  private findExistingUser(identity: AuthIdentity) {
    return this.prisma.user.findFirst({
      where: {
        OR: [
          identity.userId ? { id: identity.userId } : undefined,
          identity.email ? { email: identity.email } : undefined,
        ].filter(Boolean) as { id?: string; email?: string }[],
      },
    });
  }

  private validateRegisteredClaims(claims: JwtClaims) {
    const now = Math.floor(Date.now() / 1000);

    if (typeof claims.exp === 'number' && now >= claims.exp) {
      // How long ago it lapsed separates "the tab sat idle" from "this clock is
      // wrong", which are different bugs with the same symptom.
      throw this.reject('Token expired', {
        exp: claims.exp,
        expiredSecondsAgo: now - claims.exp,
      });
    }
    if (typeof claims.nbf === 'number' && now < claims.nbf) {
      throw this.reject('Token is not active yet');
    }

    const requiredIssuer = this.config.get<string>('AUTH_JWT_ISSUER');
    if (requiredIssuer && claims.iss !== requiredIssuer) {
      // Both sides, because "they differ" is not actionable on its own.
      throw this.reject('Invalid token issuer', {
        iss: claims.iss ?? null,
        expectedIss: requiredIssuer,
      });
    }

    const requiredAudience = this.config.get<string>('AUTH_JWT_AUDIENCE');
    if (requiredAudience) {
      const audiences = Array.isArray(claims.aud)
        ? claims.aud
        : claims.aud
          ? [claims.aud]
          : [];
      if (!audiences.includes(requiredAudience)) {
        throw this.reject('Invalid token audience', {
          aud: audiences,
          expectedAud: requiredAudience,
        });
      }
    }
  }

  private verifyHs256Jwt(token: string, secret: string): JwtClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      // The COUNT, not the token: three is a JWT, one is usually an opaque
      // access token sent where an id_token was meant.
      throw this.reject('Invalid bearer token', {
        stage: 'hs256-structure',
        segments: parts.length,
      });
    }

    const [headerPart, payloadPart, signaturePart] = parts;

    const header = this.parseJwtPart<{ alg?: string; typ?: string }>(
      headerPart,
      'header',
    );

    if (header.alg !== 'HS256') {
      // ⚠️ Unreachable through `identityFromBearerToken`, which only calls this
      // after `getTokenAlgorithm` already read `alg === 'HS256'` from the same
      // header. Kept as a guard against a future second caller, and logged so
      // that if it ever DOES fire we find out rather than guess.
      throw this.reject('Unsupported token algorithm', {
        alg: typeof header.alg === 'string' ? header.alg : null,
      });
    }

    const signedContent = `${headerPart}.${payloadPart}`;
    const expectedSignature = createHmac('sha256', secret)
      .update(signedContent)
      .digest();

    let receivedSignature: Buffer;
    try {
      receivedSignature = Buffer.from(signaturePart, 'base64url');
    } catch {
      throw this.reject('Invalid token signature', { stage: 'decode' });
    }

    if (
      expectedSignature.length !== receivedSignature.length ||
      !timingSafeEqual(expectedSignature, receivedSignature)
    ) {
      // A length mismatch means a malformed signature; an equal-length mismatch
      // means the wrong secret. Distinct causes, distinct fixes.
      throw this.reject('Invalid token signature', {
        stage:
          expectedSignature.length !== receivedSignature.length
            ? 'length'
            : 'mismatch',
      });
    }

    return this.parseJwtPart<JwtClaims>(payloadPart, 'payload');
  }

  private parseJwtPart<T>(part: string, section: string): T {
    let decoded: string;
    try {
      decoded = Buffer.from(part, 'base64url').toString('utf8');
    } catch {
      throw this.reject(`Invalid token ${section}`, { stage: 'base64url' });
    }

    try {
      return JSON.parse(decoded) as T;
    } catch {
      throw this.reject(`Invalid token ${section}`, { stage: 'json' });
    }
  }

  private extractBearerToken(
    authorization: string | string[] | undefined,
  ): string | null {
    const header = this.singleHeaderValue(authorization);
    if (!header) return null;

    const [scheme, token] = header.trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null;
    }
    return token;
  }

  private getTokenAlgorithm(token: string) {
    const [headerPart] = token.split('.', 2);
    if (!headerPart) {
      throw this.reject('Invalid bearer token', { stage: 'empty-header' });
    }
    const header = this.parseJwtPart<{ alg?: string }>(headerPart, 'header');
    return typeof header.alg === 'string' ? header.alg : null;
  }

  private firstStringClaim(
    claims: JwtClaims,
    keys: Array<keyof JwtClaims>,
  ): string | null {
    for (const key of keys) {
      const value = claims[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return null;
  }

  private normalizeEmail(email: string | null | undefined) {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    return normalized.length ? normalized : null;
  }

  private singleHeaderValue(
    value: string | string[] | undefined,
  ): string | null {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length > 0) return value[0] ?? null;
    return null;
  }
}
