import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidTargetError,
  InvalidTokenError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { PrismaService } from '../prisma/prisma.service';
import { appUrl, issuerUrl, mcpUrl } from './oauth.config';

const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 30 * 24 * 3600_000;
const UNUSED_CLIENT_TTL_MS = 7 * 24 * 3600_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const random = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;

/** A callback must be https, a loopback address (native apps), or a private-use scheme like `cursor://`. */
function isAcceptableRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
    return !['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'].includes(url.protocol);
  } catch {
    return false;
  }
}

/** What the approval page shows about an assistant waiting to be connected. */
export interface PendingRequest {
  id: string;
  clientId: string;
  name: string;
  /** Where the assistant will be sent back to — it names itself, so the page also shows this host. */
  redirectHost: string;
  redirectUri: string;
  state: string | null;
}

/**
 * The API as an OAuth authorization server for MCP clients. Plugs into the MCP SDK's
 * authorize / token / register handlers; Auth0 only signs the person in (see `handleLoginCallback`).
 */
@Injectable()
export class OAuthService implements OAuthServerProvider {
  constructor(private readonly prisma: PrismaService) {}

  readonly clientsStore: OAuthRegisteredClientsStore = {
    getClient: async (clientId) => {
      const row = await this.prisma.oAuthClient.findUnique({ where: { id: clientId } });
      if (!row) return undefined;
      return {
        ...(row.metadata as object),
        client_id: row.id,
        redirect_uris: row.redirectUris,
      } as OAuthClientInformationFull;
    },

    registerClient: async (client) => {
      if (!client.redirect_uris.every(isAcceptableRedirect)) {
        throw new InvalidClientMetadataError('redirect_uris must be https, a loopback address or an app scheme.');
      }
      await this.purgeStale();
      // Public clients only: PKCE protects the exchange, so no secret is issued or kept.
      const { client_secret: _secret, client_secret_expires_at: _expires, ...metadata } = client;
      // The SDK's handler has already minted a client_id; its type just doesn't say so.
      const id = (client as { client_id?: string }).client_id ?? randomUUID();
      const stored = { ...metadata, token_endpoint_auth_method: 'none' };
      await this.prisma.oAuthClient.create({
        data: { id, redirectUris: client.redirect_uris.map(String), metadata: stored as Prisma.InputJsonObject },
      });
      return {
        ...stored,
        client_id: id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      } as OAuthClientInformationFull;
    },
  };

  /** Clears what has expired, and clients that registered but never finished connecting. */
  private async purgeStale() {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.oAuthClient.deleteMany({
        where: { lastUsedAt: null, createdAt: { lt: new Date(now.getTime() - UNUSED_CLIENT_TTL_MS) } },
      }),
      this.prisma.oAuthRequest.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.oAuthToken.deleteMany({ where: { refreshExpiresAt: { lt: now } } }),
    ]);
  }

  private loginConfig() {
    const domain = process.env.AUTH0_DOMAIN;
    const clientId = process.env.AUTH0_LOGIN_CLIENT_ID;
    const clientSecret = process.env.AUTH0_LOGIN_CLIENT_SECRET;
    if (!domain || !clientId || !clientSecret || !mcpUrl()) {
      throw new ServerError('Agent sign-in is not configured (AUTH0_LOGIN_CLIENT_ID / _SECRET, MCP_PUBLIC_URL).');
    }
    return { domain, clientId, clientSecret, callbackUrl: `${issuerUrl()}/callback` };
  }

  /** Step 1: remember the assistant's request, then send the person to Auth0 to sign in. */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: { redirect: (url: string) => void }
  ) {
    const login = this.loginConfig();
    if (params.resource && params.resource.href !== new URL(mcpUrl() as string).href) {
      throw new InvalidTargetError('Unknown resource.');
    }
    const verifier = randomBytes(32).toString('base64url');
    const request = await this.prisma.oAuthRequest.create({
      data: {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        resource: params.resource?.href,
        scope: params.scopes?.join(' ') || null,
        upstreamVerifier: verifier,
        expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
      },
    });
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: login.clientId,
      redirect_uri: login.callbackUrl,
      scope: 'openid',
      state: request.id,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    res.redirect(`https://${login.domain}/authorize?${query}`);
  }

  /**
   * Step 2, Auth0 sent the person back: learn who they are, then hand them to the approval page.
   * Returns where to send the browser next (the web app, or the assistant when sign-in failed).
   */
  async handleLoginCallback(query: { code?: string; state?: string; error?: string }): Promise<string> {
    const request = query.state ? await this.prisma.oAuthRequest.findUnique({ where: { id: query.state } }) : null;
    if (!request || request.expiresAt < new Date())
      throw new InvalidRequestError('This sign-in has expired. Start again from your assistant.');
    if (query.error || !query.code) return this.redirectBack(request, { error: 'access_denied' });

    const login = this.loginConfig();
    const tokenResponse = await fetch(`https://${login.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: login.clientId,
        client_secret: login.clientSecret,
        code: query.code,
        code_verifier: request.upstreamVerifier,
        redirect_uri: login.callbackUrl,
      }),
    });
    if (!tokenResponse.ok) throw new ServerError('Sign-in with Auth0 failed.');
    const { access_token } = (await tokenResponse.json()) as { access_token: string };
    const profile = await fetch(`https://${login.domain}/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profile.ok) throw new ServerError('Could not read the signed-in user.');
    const { sub } = (await profile.json()) as { sub: string };

    await this.prisma.oAuthRequest.update({ where: { id: request.id }, data: { userId: sub } });
    return `${appUrl()}/agents/connect?request=${request.id}`;
  }

  /** The request the signed-in person is approving. It must be theirs. */
  async getPendingRequest(userId: string, id: string): Promise<PendingRequest> {
    const request = await this.prisma.oAuthRequest.findUnique({ where: { id }, include: { client: true } });
    if (!request || request.expiresAt < new Date()) throw new NotFoundException('This approval link has expired.');
    if (request.userId !== userId) throw new ForbiddenException('This approval link belongs to someone else.');
    const name = (request.client.metadata as { client_name?: string }).client_name;
    return {
      id: request.id,
      clientId: request.clientId,
      name: name ?? 'Agent',
      redirectHost: new URL(request.redirectUri).host || new URL(request.redirectUri).protocol,
      redirectUri: request.redirectUri,
      state: request.state,
    };
  }

  private redirectBack(request: { redirectUri: string; state: string | null }, params: Record<string, string>) {
    const url = new URL(request.redirectUri);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (request.state) url.searchParams.set('state', request.state);
    return url.toString();
  }

  /** The person approved: mint a one-time code and return where to send them back to the assistant. */
  async issueCode(userId: string, id: string): Promise<string> {
    const request = await this.prisma.oAuthRequest.findUnique({ where: { id } });
    if (!request || request.userId !== userId) throw new NotFoundException('This approval link has expired.');
    const code = random('lt_code_');
    await this.prisma.$transaction([
      this.prisma.oAuthCode.create({
        data: {
          hash: sha256(code),
          clientId: request.clientId,
          userId,
          redirectUri: request.redirectUri,
          codeChallenge: request.codeChallenge,
          resource: request.resource,
          scope: request.scope,
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      }),
      this.prisma.oAuthRequest.delete({ where: { id } }),
    ]);
    return this.redirectBack(request, { code });
  }

  /** The person said no: send the assistant back with `access_denied`. */
  async denyRequest(userId: string, id: string): Promise<string> {
    const request = await this.prisma.oAuthRequest.findUnique({ where: { id } });
    if (!request || request.userId !== userId) throw new NotFoundException('This approval link has expired.');
    await this.prisma.oAuthRequest.delete({ where: { id } });
    return this.redirectBack(request, { error: 'access_denied' });
  }

  // --- OAuthServerProvider: the SDK's token endpoint calls these -------------------------------

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
    const code = await this.prisma.oAuthCode.findUnique({ where: { hash: sha256(authorizationCode) } });
    if (!code || code.clientId !== client.client_id || code.expiresAt < new Date()) {
      throw new InvalidGrantError('Invalid or expired authorization code.');
    }
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const hash = sha256(authorizationCode);
    const code = await this.prisma.oAuthCode.findUnique({ where: { hash } });
    // deleteMany returns a count, so two racing exchanges can't both win.
    const consumed = await this.prisma.oAuthCode.deleteMany({ where: { hash } });
    if (!code || consumed.count !== 1 || code.clientId !== client.client_id || code.expiresAt < new Date()) {
      throw new InvalidGrantError('Invalid or expired authorization code.');
    }
    if (redirectUri !== undefined && redirectUri !== code.redirectUri)
      throw new InvalidGrantError('redirect_uri does not match.');
    await this.prisma.oAuthClient.update({ where: { id: client.client_id }, data: { lastUsedAt: new Date() } });
    return this.createTokens(code.userId, client.client_id, code.resource, code.scope);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const hash = sha256(refreshToken);
    const row = await this.prisma.oAuthToken.findUnique({ where: { refreshHash: hash } });
    const consumed = row ? await this.prisma.oAuthToken.deleteMany({ where: { id: row.id } }) : { count: 0 };
    if (!row || consumed.count !== 1 || row.clientId !== client.client_id || row.refreshExpiresAt < new Date()) {
      throw new InvalidGrantError('Invalid or expired refresh token.');
    }
    return this.createTokens(row.userId, row.clientId, row.resource, row.scope);
  }

  private async createTokens(
    userId: string,
    clientId: string,
    resource: string | null,
    scope: string | null
  ): Promise<OAuthTokens> {
    const access = random('lt_at_');
    const refresh = random('lt_rt_');
    await this.prisma.oAuthToken.create({
      data: {
        accessHash: sha256(access),
        refreshHash: sha256(refresh),
        clientId,
        userId,
        resource,
        scope,
        expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
        refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      ...(scope ? { scope } : {}),
    };
  }

  /** Who a bearer token belongs to; throws if it is unknown, expired or was revoked. */
  async verifyAccessToken(token: string): Promise<AuthInfo & { extra: { userId: string } }> {
    const row = await this.prisma.oAuthToken.findUnique({ where: { accessHash: sha256(token) } });
    if (!row || row.expiresAt < new Date()) throw new InvalidTokenError('Invalid or expired access token.');
    return {
      token,
      clientId: row.clientId,
      scopes: row.scope ? row.scope.split(' ') : [],
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      extra: { userId: row.userId },
    };
  }
}
