import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MAX_NOTIFY_DAYS_BEFORE, reminderBody, reminderDay } from './reminder.util';

const DAY = 86_400_000;

/** Pushes task reminders; checks once a minute. */
@Injectable()
export class TaskRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskRemindersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    try {
      const tasks = await this.prisma.task.findMany({
        where: {
          notifyDaysBefore: { not: null },
          status: { not: TaskStatus.done },
          // Recurring series can be due any day; one-offs only near their due date (±1 day for time zones).
          OR: [
            { recurrence: { not: null } },
            {
              dueDate: {
                gte: new Date(now.getTime() - DAY),
                lte: new Date(now.getTime() + (MAX_NOTIFY_DAYS_BEFORE + 1) * DAY),
              },
            },
          ],
        },
      });
      for (const task of tasks) {
        const day = reminderDay(task, now);
        if (!day) continue;
        // Claim the occurrence first, so overlapping ticks or instances push it once.
        const claimed = await this.prisma.task.updateMany({
          where: { id: task.id, OR: [{ lastNotifiedFor: null }, { lastNotifiedFor: { not: day } }] },
          data: { lastNotifiedFor: day },
        });
        if (!claimed.count) continue;
        await this.notifications.notifyBoard(task.boardId, null, task.assigneeId, () => ({
          title: task.title,
          body: reminderBody(task.notifyDaysBefore!),
          // Unique per send: a reused tag makes the browser swap it in silently instead of alerting.
          tag: `reminder:${task.id}:${now.getTime()}`,
          url: `/today?task=${task.id}`,
        }));
      }
    } catch (error) {
      this.logger.error('Reminder tick failed', error instanceof Error ? error.stack : String(error));
    }
  }
}
