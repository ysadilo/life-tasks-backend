import { Controller, Get, Query, Res } from '@nestjs/common';
import type { ServerResponse } from 'http';
import { OAuthService } from './oauth.service';
import { authorizationServerMetadata, mcpUrl, protectedResourceMetadata } from './oauth.config';

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Discovery documents and the return leg of the Auth0 sign-in. The protocol endpoints are the SDK's (oauth.module). */
@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  /** RFC 8414 (and the OpenID form some clients try first) at the issuer's own path. */
  @Get(['.well-known/oauth-authorization-server', '.well-known/openid-configuration'])
  metadata(@Res() res: ServerResponse) {
    if (!mcpUrl()) return send(res, 503, { error: 'MCP is not configured (MCP_PUBLIC_URL)' });
    send(res, 200, authorizationServerMetadata());
  }

  /** Auth0 sends the person back here after sign-in; we continue to the approval page (or back to the assistant). */
  @Get('callback')
  async callback(@Query() query: { code?: string; state?: string; error?: string }, @Res() res: ServerResponse) {
    try {
      const next = await this.oauth.handleLoginCallback(query);
      res.writeHead(302, { Location: next });
      res.end();
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : 'Sign-in failed.' });
    }
  }
}

/**
 * The same documents at the host root, where RFC 8414 / 9728 look for a server whose address has a
 * path (…/api/oauth, …/api/mcp). These routes are excluded from the `/api` prefix in main.ts, and the
 * proxy in front must send `/.well-known/*` to the API.
 */
@Controller('.well-known')
export class WellKnownController {
  @Get(['oauth-authorization-server/api/oauth', 'openid-configuration/api/oauth'])
  authorizationServer(@Res() res: ServerResponse) {
    if (!mcpUrl()) return send(res, 503, { error: 'MCP is not configured (MCP_PUBLIC_URL)' });
    send(res, 200, authorizationServerMetadata());
  }

  @Get('oauth-protected-resource/api/mcp')
  protectedResource(@Res() res: ServerResponse) {
    if (!mcpUrl()) return send(res, 503, { error: 'MCP is not configured (MCP_PUBLIC_URL)' });
    send(res, 200, protectedResourceMetadata());
  }
}
