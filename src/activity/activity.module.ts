import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { BoardsModule } from '../boards/boards.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [BoardsModule, NotificationsModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
