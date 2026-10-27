import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { TasksModule } from './tasks/tasks.module';
import { BoardsModule } from './boards/boards.module';
import { LifeAreasModule } from './life-areas/life-areas.module';
import { PreferencesModule } from './preferences/preferences.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [PrismaModule, TasksModule, BoardsModule, LifeAreasModule, PreferencesModule, FeedbackModule],
})
export class AppModule {}
