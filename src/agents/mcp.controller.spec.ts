import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpController } from './mcp.controller';
import { AgentsService } from './agents.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { verifyAccessToken } from '../auth/verify-access-token';

jest.mock('../auth/verify-access-token', () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../auth/verify-connect-token', () => ({ verifyConnectToken: jest.fn() }));

describe('McpController over HTTP', () => {
  let app: INestApplication;
  let url: string;
  const connect = jest.fn();
  const record = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: AgentsService, useValue: { connect, record } },
        { provide: PrismaService, useValue: {} },
        { provide: TasksService, useValue: {} },
        { provide: ActivityService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    const origin = await app.getUrl();
    process.env.MCP_PUBLIC_URL = `${origin.replace('[::1]', 'localhost')}/api/mcp`;
    url = process.env.MCP_PUBLIC_URL;
  });

  afterAll(() => app.close());
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.AUTH0_DOMAIN = 'tenant.auth0.com';
  });

  it('answers an unauthenticated call with 401 and where to find the OAuth metadata', async () => {
    const res = await fetch(url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${new URL('./.well-known/oauth-protected-resource', url)}"`
    );
  });

  it('publishes the protected-resource metadata pointing at Auth0', async () => {
    const res = await fetch(new URL('./.well-known/oauth-protected-resource', url));
    expect(await res.json()).toEqual({
      resource: url,
      authorization_servers: ['https://tenant.auth0.com/'],
      bearer_methods_supported: ['header'],
    });
  });

  it('serves a real MCP client: verifies the token for the MCP audience, names the agent from initialize', async () => {
    (verifyAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', azp: 'client-1' });
    connect.mockResolvedValue({ id: 'c1', name: 'Claude', permissions: ['read'], boardIds: [] });

    const client = new Client({ name: 'claude-ai', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: 'Bearer good' } } })
    );
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((t) => t.name)).toContain('create_task');
    expect(verifyAccessToken).toHaveBeenCalledWith('good', url);
    expect(connect).toHaveBeenCalledWith('u1', 'client-1', 'claude-ai');
  });

  it('refuses a connection that was revoked', async () => {
    (verifyAccessToken as jest.Mock).mockResolvedValue({ sub: 'u1', azp: 'client-1' });
    const { ForbiddenException } = jest.requireActual('@nestjs/common');
    connect.mockRejectedValue(new ForbiddenException('Access was revoked'));

    const res = await fetch(url, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer good' },
    });
    expect(res.status).toBe(403);
  });
});
