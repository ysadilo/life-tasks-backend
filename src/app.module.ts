import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { TasksModule } from './tasks/tasks.module';
import { BoardsModule } from './boards/boards.module';
import { LifeAreasModule } from './life-areas/life-areas.module';
import { ActivityModule } from './activity/activity.module';
import { PreferencesModule } from './preferences/preferences.module';
import { FeedbackModule } from './feedback/feedback.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AgentsModule } from './agents/agents.module';
import { OAuthModule } from './oauth/oauth.module';

@Module({
  imports: [
    PrismaModule,
    TasksModule,
    BoardsModule,
    LifeAreasModule,
    PreferencesModule,
    ActivityModule,
    FeedbackModule,
    NotificationsModule,
    AgentsModule,
    OAuthModule,
  ],
})
export class AppModule {}
