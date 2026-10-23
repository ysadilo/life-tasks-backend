import { Injectable, Logger } from '@nestjs/common';
import { ActivityType, Task, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateTaskDto } from '../tasks/task.dto';

export interface ActivityEvent {
  type: ActivityType;
  targetUserId?: string | null;
}

/** What a task update means for the feed: finishing it and/or handing it to someone. */
export function eventsForUpdate(before: Task, after: Task, dto: UpdateTaskDto): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const finishedOccurrence = dto.occurrenceDate !== undefined && dto.occurrenceDone !== false;
  const finishedTask = before.status !== TaskStatus.done && after.status === TaskStatus.done;
  if (finishedOccurrence || finishedTask) events.push({ type: ActivityType.finished });
  if (before.assigneeId !== after.assigneeId) {
    events.push({ type: ActivityType.assigned, targetUserId: after.assigneeId });
  }
  return events;
}

const FEED_LIMIT = 20;

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findRecent(boardId: string) {
    const rows = await this.prisma.activity.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      take: FEED_LIMIT,
      include: { actor: { select: { email: true } }, target: { select: { email: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      taskTitle: row.taskTitle,
      actorId: row.actorId,
      actorEmail: row.actor.email,
      targetUserId: row.targetUserId,
      targetEmail: row.target?.email ?? null,
      createdAt: row.createdAt,
    }));
  }

  async recordAdded(boardId: string, actorId: string, task: Task) {
    await this.record(boardId, actorId, task.title, [{ type: ActivityType.added }]);
  }

  async recordUpdate(boardId: string, actorId: string, before: Task, after: Task, dto: UpdateTaskDto) {
    await this.record(boardId, actorId, after.title, eventsForUpdate(before, after, dto));
  }

  /** Only shared boards keep a feed — a personal board's "activity" would just be you. */
  private async record(boardId: string, actorId: string, taskTitle: string, events: ActivityEvent[]) {
    if (events.length === 0) return;
    // Best effort: the task change is already saved, so a feed failure must not turn it into an error.
    try {
      const board = await this.prisma.board.findUnique({ where: { id: boardId }, select: { shared: true } });
      if (!board?.shared) return;
      await this.prisma.activity.createMany({
        data: events.map((event) => ({
          boardId,
          actorId,
          taskTitle,
          type: event.type,
          targetUserId: event.targetUserId ?? null,
        })),
      });
    } catch (error) {
      this.logger.error(
        `Could not record activity on board ${boardId}`,
        error instanceof Error ? error.stack : String(error)
      );
    }
  }
}
