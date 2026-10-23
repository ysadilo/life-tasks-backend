import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { BoardsModule } from '../boards/boards.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [BoardsModule, ActivityModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
