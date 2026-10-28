import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AuthorizeAgentDto, ConnectRequestDto, UpdateAgentDto, UpdateAgentSettingsDto } from './agent.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OAuthService } from '../oauth/oauth.service';

/** What Settings › AI agents reads and edits. Signed-in people only; agents use /mcp. */
@Controller('agents')
@UseGuards(Auth0AuthGuard)
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly oauth: OAuthService
  ) {}

  @Get()
  async findMany(@CurrentUser() userId: string) {
    const [enabled, agents] = await Promise.all([this.agents.isEnabled(userId), this.agents.findForUser(userId)]);
    return { serverUrl: process.env.MCP_PUBLIC_URL ?? null, enabled, agents };
  }

  @Get('activity')
  activity(@CurrentUser() userId: string) {
    return this.agents.findActivity(userId);
  }

  /** What the approval page shows about the assistant waiting to be connected. */
  @Post('connect-request')
  @HttpCode(200)
  async findConnectRequest(@CurrentUser() userId: string, @Body() dto: ConnectRequestDto) {
    const { clientId, name, redirectHost } = await this.oauth.getPendingRequest(userId, dto.request);
    return { name, redirectHost, alreadyConnected: await this.agents.isConnected(userId, clientId) };
  }

  /** Approve (saving the chosen permissions) or deny; returns where to send the browser back to the assistant. */
  @Post('connect')
  @HttpCode(200)
  async authorize(@CurrentUser() userId: string, @Body() dto: AuthorizeAgentDto) {
    if (dto.deny) return { redirectUrl: await this.oauth.denyRequest(userId, dto.request) };
    const { clientId, name } = await this.oauth.getPendingRequest(userId, dto.request);
    await this.agents.authorize(userId, clientId, name, dto);
    return { redirectUrl: await this.oauth.issueCode(userId, dto.request) };
  }

  @Patch('settings')
  setEnabled(@CurrentUser() userId: string, @Body() dto: UpdateAgentSettingsDto) {
    return this.agents.setEnabled(userId, dto.enabled);
  }

  @Patch(':id')
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.agents.revoke(userId, id);
  }
}
