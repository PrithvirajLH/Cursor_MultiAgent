import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TeamRole, UserRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthRequest } from './current-user.decorator';

type JwtClaims = {
  sub?: string;
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
};

@Injectable()
export class AuthGuard implements CanActivate {
  private azureJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private azureJwksIssuer: string | null = null;
  private bootstrapOwnerEmails: Set<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

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
      throw new UnauthorizedException('Missing authentication credentials');
    }

    const user = authIdentity.provisionIfMissing
      ? await this.findOrProvisionUser(authIdentity)
      : await this.findExistingUser(authIdentity);

    if (!user) {
      throw new UnauthorizedException('Unknown user');
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

    request.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      teamId: resolvedTeamId,
      teamRole: membership?.role ?? null,
      primaryTeamId: user.primaryTeamId ?? null,
    };

    return true;
  }

  private identityFromInsecureHeaders(
    userIdHeader: string | string[] | undefined,
    emailHeader: string | string[] | undefined,
  ): AuthIdentity | null {
    if (!this.shouldAllowInsecureHeaders()) {
      throw new UnauthorizedException('Bearer token is required');
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
    const configured = this.config.get<string>('AUTH_ALLOW_INSECURE_HEADERS');
    return configured === 'true';
  }

  private async identityFromBearerToken(token: string): Promise<AuthIdentity> {
    const algorithm = this.getTokenAlgorithm(token);
    const secret = this.config.get<string>('AUTH_JWT_SECRET');
    if (algorithm === 'HS256') {
      if (!secret) {
        throw new UnauthorizedException('HS256 auth is not configured');
      }

      const claims = this.verifyHs256Jwt(token, secret);
      this.validateRegisteredClaims(claims);

      const userId = typeof claims.sub === 'string' ? claims.sub : null;
      const email = this.normalizeEmail(
        this.firstStringClaim(claims, ['email']),
      );

      if (!userId && !email) {
        throw new UnauthorizedException(
          'Token must include sub or email claim',
        );
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
    return {
      userId: null,
      email: this.normalizeEmail(
        this.firstStringClaim(claims, ['preferred_username', 'upn', 'email']),
      ),
      displayName: this.firstStringClaim(claims, ['name']),
      department: this.firstStringClaim(claims, ['department']),
      location: this.firstStringClaim(claims, ['office_location']),
      provisionIfMissing: true,
    };
  }

  private async verifyAzureJwt(token: string): Promise<JwtClaims> {
    const tenantId = this.config.get<string>('AZURE_TENANT_ID');
    const clientId = this.config.get<string>('AZURE_CLIENT_ID');
    if (!tenantId || !clientId) {
      throw new UnauthorizedException('Azure auth is not configured');
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
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
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
      throw new UnauthorizedException('Invalid Azure JWKS configuration');
    }
  }

  private async findOrProvisionUser(identity: AuthIdentity) {
    const email = this.normalizeEmail(identity.email);
    if (!email) {
      throw new UnauthorizedException('Token must include email claim');
    }

    const shouldBootstrapOwner = this.shouldBootstrapOwner(email);

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    const displayName = identity.displayName?.trim() || email;
    const provisionedRole = shouldBootstrapOwner
      ? UserRole.OWNER
      : UserRole.EMPLOYEE;

    if (!existing) {
      return this.prisma.user.create({
        data: {
          email,
          displayName,
          role: provisionedRole,
          department: identity.department,
          location: identity.location,
        },
      });
    }

    const updateData: {
      displayName?: string;
      department?: string | null;
      location?: string | null;
      role?: UserRole;
    } = {};
    if (existing.displayName !== displayName) {
      updateData.displayName = displayName;
    }
    if (
      identity.department !== null &&
      existing.department !== identity.department
    ) {
      updateData.department = identity.department;
    }
    if (identity.location !== null && existing.location !== identity.location) {
      updateData.location = identity.location;
    }
    if (shouldBootstrapOwner && existing.role !== UserRole.OWNER) {
      updateData.role = UserRole.OWNER;
    }

    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    return this.prisma.user.update({
      where: { id: existing.id },
      data: updateData,
    });
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
      throw new UnauthorizedException('Token expired');
    }
    if (typeof claims.nbf === 'number' && now < claims.nbf) {
      throw new UnauthorizedException('Token is not active yet');
    }

    const requiredIssuer = this.config.get<string>('AUTH_JWT_ISSUER');
    if (requiredIssuer && claims.iss !== requiredIssuer) {
      throw new UnauthorizedException('Invalid token issuer');
    }

    const requiredAudience = this.config.get<string>('AUTH_JWT_AUDIENCE');
    if (requiredAudience) {
      const audiences = Array.isArray(claims.aud)
        ? claims.aud
        : claims.aud
          ? [claims.aud]
          : [];
      if (!audiences.includes(requiredAudience)) {
        throw new UnauthorizedException('Invalid token audience');
      }
    }
  }

  private verifyHs256Jwt(token: string, secret: string): JwtClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    const [headerPart, payloadPart, signaturePart] = parts;

    const header = this.parseJwtPart<{ alg?: string; typ?: string }>(
      headerPart,
      'header',
    );

    if (header.alg !== 'HS256') {
      throw new UnauthorizedException('Unsupported token algorithm');
    }

    const signedContent = `${headerPart}.${payloadPart}`;
    const expectedSignature = createHmac('sha256', secret)
      .update(signedContent)
      .digest();

    let receivedSignature: Buffer;
    try {
      receivedSignature = Buffer.from(signaturePart, 'base64url');
    } catch {
      throw new UnauthorizedException('Invalid token signature');
    }

    if (
      expectedSignature.length !== receivedSignature.length ||
      !timingSafeEqual(expectedSignature, receivedSignature)
    ) {
      throw new UnauthorizedException('Invalid token signature');
    }

    return this.parseJwtPart<JwtClaims>(payloadPart, 'payload');
  }

  private parseJwtPart<T>(part: string, section: string): T {
    let decoded: string;
    try {
      decoded = Buffer.from(part, 'base64url').toString('utf8');
    } catch {
      throw new UnauthorizedException(`Invalid token ${section}`);
    }

    try {
      return JSON.parse(decoded) as T;
    } catch {
      throw new UnauthorizedException(`Invalid token ${section}`);
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
      throw new UnauthorizedException('Invalid bearer token');
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
