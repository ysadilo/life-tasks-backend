import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyAccessToken } from './verify-access-token';

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth?: { userId: string; token: string };
}

/**
 * Verifies an Auth0 access token (RS256, signed via the tenant JWKS) on the
 * `Authorization: Bearer` header and attaches `{ auth: { userId, token } }`.
 * This is phase 4 from the README — `boardId`/`ownerId` are no longer trusted
 * from the client.
 */
@Injectable()
export class Auth0AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;

    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);

    try {
      const payload = await verifyAccessToken(token);
      req.auth = { userId: payload.sub as string, token };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
