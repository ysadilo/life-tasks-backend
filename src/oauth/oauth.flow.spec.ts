import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OAuthModule } from './oauth.module';
import { API_PREFIX, API_PREFIX_OPTIONS } from '../app.config';
import { OAuthService } from './oauth.service';

type Row = Record<string, unknown>;

/** Just enough of Prisma's API, in memory, for the OAuth tables. */
function table(key: string, rows: Row[] = []) {
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([field, cond]) => {
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        const { lt } = cond as { lt?: Date };
        return lt === undefined || (row[field] as Date) < lt;
      }
      return row[field] === cond;
    });
  return {
    rows,
    create: async ({ data }: { data: Row }) => {
      const row = { ...data, [key]: data[key] ?? randomBytes(8).toString('hex') };
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    update: async ({ where, data }: { where: Row; data: Row }) =>
      Object.assign(rows.find((r) => matches(r, where)) as Row, data),
    delete: async ({ where }: { where: Row }) => {
      const i = rows.findIndex((r) => matches(r, where));
      return rows.splice(i, 1)[0];
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const gone = rows.filter((r) => matches(r, where));
      gone.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { count: gone.length };
    },
  };
}

const clients = table('id');
const fakePrisma = {
  oAuthClient: clients,
  oAuthRequest: {
    ...table('id'),
    findUnique: async ({ where, include }: { where: Row; include?: Row }) => {
      const row = await fakePrisma.oAuthRequest.rows.find((r: Row) => r.id === where.id);
      if (!row) return null;
      return include?.client
        ? { ...row, client: await clients.findUnique({ where: { id: row.clientId as string } }) }
        : row;
    },
  },
  oAuthCode: table('hash'),
  oAuthToken: table('id'),
  $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
};

@Global()
@Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
class FakePrismaModule {}

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

describe('the OAuth server, end to end', () => {
  let app: INestApplication;
  let api: string;
  let oauth: OAuthService;
  const realFetch = global.fetch;

  const form = (body: Record<string, string>) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakePrismaModule, OAuthModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX, API_PREFIX_OPTIONS);
    await app.listen(0);
    const origin = (await app.getUrl()).replace('[::1]', 'localhost');
    process.env.MCP_PUBLIC_URL = `${origin}/api/mcp`;
    process.env.AUTH0_DOMAIN = 'tenant.auth0.com';
    process.env.AUTH0_LOGIN_CLIENT_ID = 'login-app';
    process.env.AUTH0_LOGIN_CLIENT_SECRET = 'login-secret';
    api = `${origin}/api/oauth`;
    oauth = moduleRef.get(OAuthService);

    // Auth0 is the only outside call: signing the person in and telling us who they are.
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://tenant.auth0.com/oauth/token') return Response.json({ access_token: 'auth0-access' });
      if (url === 'https://tenant.auth0.com/userinfo') return Response.json({ sub: 'auth0|u1' });
      return realFetch(input, init);
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  const register = async (redirect = REDIRECT) => {
    const res = await fetch(`${api}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }),
    });
    return { status: res.status, body: (await res.json()) as Row };
  };

  /** Registers, signs in through the fake Auth0, approves, and returns the code the assistant would receive. */
  async function connect(clientId: string, state = 'xyz') {
    const authorize = await fetch(
      `${api}/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        resource: process.env.MCP_PUBLIC_URL as string,
      })}`,
      { redirect: 'manual' }
    );
    const toAuth0 = new URL(authorize.headers.get('location') as string);
    const callback = await fetch(`${api}/callback?code=auth0-code&state=${toAuth0.searchParams.get('state')}`, {
      redirect: 'manual',
    });
    const requestId = new URL(callback.headers.get('location') as string).searchParams.get('request') as string;
    const back = new URL(await oauth.issueCode('auth0|u1', requestId));
    return { authorize, toAuth0, callback, requestId, back };
  }

  it('advertises itself under the issuer', async () => {
    const meta = (await (await fetch(`${api}/.well-known/oauth-authorization-server`)).json()) as Row;
    expect(meta).toMatchObject({
      issuer: api,
      authorization_endpoint: `${api}/authorize`,
      token_endpoint: `${api}/token`,
      registration_endpoint: `${api}/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('also serves the discovery documents at the host root for addresses with a path', async () => {
    const root = new URL(api).origin;
    const authServer = (await (await fetch(`${root}/.well-known/oauth-authorization-server/api/oauth`)).json()) as Row;
    const openid = (await (await fetch(`${root}/.well-known/openid-configuration/api/oauth`)).json()) as Row;
    const resource = (await (await fetch(`${root}/.well-known/oauth-protected-resource/api/mcp`)).json()) as Row;
    expect(authServer.issuer).toBe(api);
    expect(openid.issuer).toBe(api);
    expect(resource).toMatchObject({ resource: process.env.MCP_PUBLIC_URL, authorization_servers: [api] });
  });

  it('registers an assistant as a public client, and refuses an unsafe callback', async () => {
    const ok = await register();
    expect(ok.status).toBe(201);
    expect(ok.body.client_id).toEqual(expect.any(String));
    expect(ok.body.client_secret).toBeUndefined();
    expect(clients.rows).toHaveLength(1);

    expect((await register('http://evil.example/cb')).status).toBe(400);
    expect((await register('javascript:alert(1)')).status).toBe(400);
  });

  it('runs the whole flow: sign in with Auth0, approve, exchange the code, refresh', async () => {
    const { body } = await register();
    const clientId = body.client_id as string;
    const flow = await connect(clientId);

    expect(flow.authorize.status).toBe(302);
    expect(flow.toAuth0.origin + flow.toAuth0.pathname).toBe('https://tenant.auth0.com/authorize');
    expect(flow.toAuth0.searchParams.get('client_id')).toBe('login-app');
    expect(flow.callback.headers.get('location')).toContain('/agents/connect?request=');
    expect(flow.back.origin + flow.back.pathname).toBe(REDIRECT);
    expect(flow.back.searchParams.get('state')).toBe('xyz');

    const code = flow.back.searchParams.get('code') as string;
    const token = await fetch(
      `${api}/token`,
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: REDIRECT,
      })
    );
    expect(token.status).toBe(200);
    const tokens = (await token.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(tokens.token_type).toBe('Bearer');
    expect(await oauth.verifyAccessToken(tokens.access_token)).toMatchObject({
      clientId,
      extra: { userId: 'auth0|u1' },
    });

    // A code works once.
    const again = await fetch(
      `${api}/token`,
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: REDIRECT,
      })
    );
    expect(again.status).toBe(400);

    // Refresh rotates: the new pair works, the old refresh token doesn't.
    const refreshed = await fetch(
      `${api}/token`,
      form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    );
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };
    await expect(oauth.verifyAccessToken(next.access_token)).resolves.toBeDefined();
    await expect(oauth.verifyAccessToken(tokens.access_token)).rejects.toThrow();
    const replay = await fetch(
      `${api}/token`,
      form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    );
    expect(replay.status).toBe(400);
  });

  it('rejects a wrong PKCE verifier, and a different client using the code', async () => {
    const clientId = (await register()).body.client_id as string;
    const other = (await register()).body.client_id as string;
    const code = (await connect(clientId)).back.searchParams.get('code') as string;

    const wrongVerifier = await fetch(
      `${api}/token`,
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'x'.repeat(50),
        client_id: clientId,
        redirect_uri: REDIRECT,
      })
    );
    expect(wrongVerifier.status).toBe(400);

    const stolen = await fetch(
      `${api}/token`,
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: other,
        redirect_uri: REDIRECT,
      })
    );
    expect(stolen.status).toBe(400);
  });

  it("won't send someone else's pending request to the approval page, or use a resource that isn't ours", async () => {
    const clientId = (await register()).body.client_id as string;
    const { requestId } = await connect(clientId);
    await expect(oauth.getPendingRequest('auth0|someone-else', requestId)).rejects.toThrow();

    const wrongResource = await fetch(
      `${api}/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: 'https://elsewhere.example/mcp',
      })}`,
      { redirect: 'manual' }
    );
    expect(wrongResource.headers.get('location')).toContain('error=');
  });

  it('sends the assistant back with access_denied when the person says no', async () => {
    const clientId = (await register()).body.client_id as string;
    const authorize = await fetch(
      `${api}/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'nope',
      })}`,
      { redirect: 'manual' }
    );
    const id = new URL(authorize.headers.get('location') as string).searchParams.get('state') as string;
    await fetch(`${api}/callback?code=auth0-code&state=${id}`, { redirect: 'manual' });

    const denied = new URL(await oauth.denyRequest('auth0|u1', id));
    expect(denied.searchParams.get('error')).toBe('access_denied');
    expect(denied.searchParams.get('state')).toBe('nope');
  });
});
