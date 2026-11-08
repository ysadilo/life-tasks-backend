import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { BoardsModule } from '../boards/boards.module';
import { ActivityModule } from '../activity/activity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TaskRemindersService } from './task-reminders.service';

@Module({
  imports: [BoardsModule, ActivityModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskRemindersService],
  exports: [TasksService],
})
export class TasksModule {}
