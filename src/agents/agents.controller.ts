import { Body, Controller, Delete, Get, HttpCode, Param, Patch, UseGuards } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { UpdateAgentDto, UpdateAgentSettingsDto } from './agent.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

/** What Settings › AI agents reads and edits. Signed-in people only; agents use /mcp. */
@Controller('agents')
@UseGuards(Auth0AuthGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  async findMany(@CurrentUser() userId: string) {
    const [enabled, agents] = await Promise.all([this.agents.isEnabled(userId), this.agents.findForUser(userId)]);
    return { serverUrl: process.env.MCP_PUBLIC_URL ?? null, enabled, agents };
  }

  @Get('activity')
  activity(@CurrentUser() userId: string) {
    return this.agents.findActivity(userId);
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
