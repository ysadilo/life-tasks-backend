import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

let jwks: JWTVerifyGetKey | undefined;

function keySet(): JWTVerifyGetKey {
  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) throw new UnauthorizedException('Auth is not configured (AUTH0_DOMAIN)');
  jwks ??= createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
  return jwks;
}

/** Verifies an Auth0 access token (RS256, tenant JWKS) for the given API audience and returns its claims. */
export async function verifyAccessToken(token: string, audience = process.env.AUTH0_AUDIENCE): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, keySet(), {
    issuer: `https://${process.env.AUTH0_DOMAIN}/`,
    audience,
  });
  if (!payload.sub) throw new Error('token has no sub');
  return payload;
}
