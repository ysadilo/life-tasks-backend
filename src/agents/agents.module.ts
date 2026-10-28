import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { McpController } from './mcp.controller';
import { AgentsService } from './agents.service';
import { TasksModule } from '../tasks/tasks.module';
import { ActivityModule } from '../activity/activity.module';
import { OAuthModule } from '../oauth/oauth.module';

@Module({
  imports: [TasksModule, ActivityModule, OAuthModule],
  controllers: [AgentsController, McpController],
  providers: [AgentsService],
})
export class AgentsModule {}
