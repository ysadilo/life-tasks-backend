import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { AgentsService } from './agents.service';
import { AgentToolkit } from './agent-toolkit';
import { OAuthService } from '../oauth/oauth.service';
import { protectedResourceMetadata } from '../oauth/oauth.config';

type McpRequest = IncomingMessage & { body?: unknown };

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** Client name from the MCP `initialize` handshake — the only request that carries it. */
function clientNameOf(body: unknown): string | undefined {
  const call = body as { method?: string; params?: { clientInfo?: { name?: unknown } } } | undefined;
  const name = call?.method === 'initialize' ? call.params?.clientInfo?.name : undefined;
  return typeof name === 'string' ? name : undefined;
}

/**
 * The remote MCP server AI assistants connect to. Stateless: every POST is its
 * own request, authenticated by an Auth0 OAuth access token whose audience is
 * `MCP_PUBLIC_URL` (the URL clients are given). The API is only the resource
 * server — Auth0 is the OAuth authorization server (dynamic client registration).
 */
@Controller()
export class McpController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityService,
    private readonly agents: AgentsService,
    private readonly oauth: OAuthService
  ) {}

  private get resourceUrl() {
    return process.env.MCP_PUBLIC_URL;
  }

  /** RFC 9728: tells an MCP client which authorization server to use. */
  @Get('.well-known/oauth-protected-resource')
  metadata(@Res() res: ServerResponse) {
    if (!this.resourceUrl) return send(res, 503, { error: 'MCP is not configured (MCP_PUBLIC_URL)' });
    send(res, 200, protectedResourceMetadata());
  }

  @Get('mcp')
  notStreamable(@Res() res: ServerResponse) {
    send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null }, { Allow: 'POST' });
  }

  @Post('mcp')
  async handle(@Req() req: McpRequest, @Res() res: ServerResponse) {
    const resource = this.resourceUrl;
    if (!resource) return send(res, 503, { error: 'MCP is not configured (MCP_PUBLIC_URL)' });

    const header = req.headers.authorization;
    const unauthorized = (message: string) =>
      send(
        res,
        401,
        { error: message },
        {
          'WWW-Authenticate': `Bearer resource_metadata="${new URL('./.well-known/oauth-protected-resource', resource)}"`,
        }
      );
    if (!header?.startsWith('Bearer ')) return unauthorized('Missing bearer token');

    let userId: string;
    let clientId: string;
    try {
      const info = await this.oauth.verifyAccessToken(header.slice('Bearer '.length));
      userId = info.extra.userId;
      clientId = info.clientId;
    } catch {
      return unauthorized('Invalid access token');
    }

    let connection;
    try {
      connection = await this.agents.connect(userId, clientId, clientNameOf(req.body));
    } catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.() ?? 500;
      return send(res, status, { error: (error as Error).message });
    }

    const server = new McpServer({ name: 'life-tasks', version: '1.0.0' });
    new AgentToolkit(
      { prisma: this.prisma, tasks: this.tasks, activity: this.activity, agents: this.agents },
      userId,
      connection
    ).register(server);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
