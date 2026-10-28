import { jwtVerify, type JWTPayload } from 'jose';

/** Verifies the short-lived HS256 token the Auth0 "Approve AI agent" Action signs (deploy/auth0). */
export async function verifyConnectToken(token: string, secret: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
  return payload;
}
