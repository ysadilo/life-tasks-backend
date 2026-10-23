import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './auth0-auth.guard';

function auth(ctx: ExecutionContext) {
  const { auth } = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!auth) throw new Error('Auth decorators used on a route without Auth0AuthGuard');
  return auth;
}

/** The authenticated Auth0 user id (`sub`). Only valid on routes guarded by {@link Auth0AuthGuard}. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => auth(ctx).userId);

/** The raw Auth0 access token — used to call `/userinfo` when bootstrapping a user. */
export const AccessToken = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => auth(ctx).token);

/** The board the client is acting on (`X-Board-Id`), if it named one. Membership is checked by BoardsService.resolveBoardId. */
export const RequestedBoardId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  const header = ctx.switchToHttp().getRequest<AuthedRequest>().headers['x-board-id'];
  return typeof header === 'string' && header ? header : undefined;
});
