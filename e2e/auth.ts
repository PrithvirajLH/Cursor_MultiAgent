import { createHmac } from 'crypto';

const JWT_SECRET = process.env.E2E_AUTH_JWT_SECRET ?? 'e2e-local-auth-secret';

type JwtHeader = {
  alg: 'HS256';
  typ: 'JWT';
};

type JwtPayload = {
  email: string;
  iat: number;
  exp: number;
};

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signJwt(header: JwtHeader, payload: JwtPayload) {
  const headerPart = encodeBase64Url(JSON.stringify(header));
  const payloadPart = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');
  return `${headerPart}.${payloadPart}.${signature}`;
}

export function createBearerToken(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const payload: JwtPayload = {
    email: normalizedEmail,
    iat: now - 30,
    exp: now + 60 * 60,
  };
  return signJwt(header, payload);
}

export function authHeaders(email: string) {
  return {
    Authorization: `Bearer ${createBearerToken(email)}`,
  };
}
