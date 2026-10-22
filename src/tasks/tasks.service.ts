import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Task, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResolveMissedAction, UpdateTaskDto } from './task.dto';
import { occursOn, previousOccurrenceBefore } from './recurrence.util';

export interface FindTasksFilter {
  boardId: string;
  status?: TaskStatus;
  from?: Date;
  to?: Date;
  /** When true, return recurring series regardless of status; when a status is
   *  given without this flag, recurring series are excluded from that list. */
  recurring?: boolean;
  /** Caller's local calendar day ("today"). Drives the lazy today→needs_triage
   *  rollover and recurring missed-occurrence detection below — both run as a
   *  side effect of listing, on whichever page the caller happens to load first. */
  today?: Date;
}

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(filter: FindTasksFilter) {
    if (filter.today) {
      await Promise.all([
        this.rolloverStaleToday(filter.boardId, filter.today),
        this.promoteDueTasks(filter.boardId, filter.today),
        this.detectMissedOccurrences(filter.boardId, filter.today),
      ]);
    }

    const where: Prisma.TaskWhereInput = { boardId: filter.boardId };

    if (filter.recurring) {
      where.recurrence = { not: null };
      return this.prisma.task.findMany({ where, orderBy: { dueDate: 'asc' } });
    }

    // Calendar range: virtual occurrences are expanded client-side, so return the
    // recurring series whose active window overlaps the range, plus one-off tasks
    // matching by due / completion / mounted day.
    if (filter.from || filter.to) {
      const range = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
      where.OR = [
        { recurrence: null, dueDate: range },
        { recurrence: null, completedAt: range },
        { recurrence: null, todayDate: range },
        {
          recurrence: { not: null },
          ...(filter.to ? { dueDate: { lte: filter.to } } : {}),
          ...(filter.from ? { OR: [{ recurrenceEndDate: null }, { recurrenceEndDate: { gte: filter.from } }] } : {}),
        },
      ];
      return this.prisma.task.findMany({ where, orderBy: { dueDate: 'asc' } });
    }

    // Board lists never show recurring series — their occurrences live on the calendar.
    where.recurrence = null;
    if (filter.status) where.status = filter.status;

    return this.prisma.task.findMany({ where, orderBy: { dueDate: 'asc' } });
  }

  /** Undone, non-recurring Today tasks whose day has passed fall back to Triage. */
  private async rolloverStaleToday(boardId: string, today: Date) {
    await this.prisma.task.updateMany({
      where: {
        boardId,
        status: TaskStatus.today,
        recurrence: null,
        // A null todayDate (moved to Today before it was recorded) is stale too.
        OR: [{ todayDate: null }, { todayDate: { lt: startOfUTCDay(today) } }],
      },
      data: { status: TaskStatus.needs_triage },
    });
  }

  /** A one-off backlog task surfaces on Today once its due date arrives (recurring series stay virtual). */
  private async promoteDueTasks(boardId: string, today: Date) {
    const day = startOfUTCDay(today);
    await this.prisma.task.updateMany({
      where: { boardId, status: TaskStatus.backlog, recurrence: null, dueDate: { lte: day } },
      data: { status: TaskStatus.today, todayDate: day },
    });
  }

  /**
   * Flags a recurring task's most recent undone occurrence as missed once its
   * day has passed and the series has no occurrence today (a daily task never
   * gets flagged — it's already back on Today). Auto-clears once a new
   * occurrence day arrives, since the series is "already in today's view" again.
   */
  private async detectMissedOccurrences(boardId: string, today: Date) {
    const day = startOfUTCDay(today);
    const recurring = await this.prisma.task.findMany({ where: { boardId, recurrence: { not: null } } });

    await Promise.all(
      recurring.map((task) => {
        if (occursOn(task, day)) {
          if (task.missedDates.length === 0) return null;
          return this.prisma.task.update({ where: { id: task.id }, data: { missedDates: [] } });
        }
        if (task.missedDates.length > 0) return null;

        const missed = previousOccurrenceBefore(task, day);
        if (!missed) return null;
        const isDone = task.completedDates.some((d) => startOfUTCDay(d).getTime() === missed.getTime());
        if (isDone) return null;
        const alreadyResolved =
          task.lastResolvedMissedOccurrence &&
          missed.getTime() <= startOfUTCDay(task.lastResolvedMissedOccurrence).getTime();
        if (alreadyResolved) return null;

        return this.prisma.task.update({ where: { id: task.id }, data: { missedDates: [missed] } });
      })
    );
  }

  async findOne(id: string, boardId?: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task || (boardId && task.boardId !== boardId)) {
      throw new NotFoundException(`Task ${id} not found`);
    }
    return task;
  }

  create(boardId: string, data: Prisma.TaskUncheckedCreateWithoutBoardInput, today = new Date()) {
    if (data.recurrence && !data.dueDate) {
      throw new BadRequestException('A recurring task needs a start date (dueDate).');
    }
    if (data.recurrence) {
      // A recurring series is not a board item; keep it off Today / Done.
      data = { ...data, status: TaskStatus.backlog, todayDate: null };
    } else {
      const promo = this.dueTodayPromotion(data.dueDate, (data.status as TaskStatus) ?? TaskStatus.backlog, today);
      if (promo) data = { ...data, ...promo };
    }
    return this.prisma.task.create({
      data: { ...data, boardId },
    });
  }

  /** A one-off task due today (or earlier) belongs on Today, not the backlog. */
  private dueTodayPromotion(
    dueDate: Prisma.TaskUncheckedCreateWithoutBoardInput['dueDate'],
    status: TaskStatus,
    now: Date
  ): { status: TaskStatus; todayDate: Date } | null {
    if (!dueDate || status !== TaskStatus.backlog) return null;
    const today = startOfUTCDay(now);
    if (startOfUTCDay(new Date(dueDate as string)) > today) return null;
    return { status: TaskStatus.today, todayDate: today };
  }

  async update(id: string, dto: UpdateTaskDto, boardId?: string, today = new Date()) {
    const current = await this.findOne(id, boardId);

    if (dto.occurrenceDate !== undefined) {
      return this.toggleOccurrence(current.id, dto.occurrenceDate, dto.occurrenceDone ?? true);
    }

    if (dto.resolveMissedAction !== undefined) {
      return this.resolveMissed(current, dto.resolveMissedAction);
    }

    const { occurrenceDone: _od, occurrenceDate: _oda, ...rest } = dto;
    let data: Prisma.TaskUncheckedUpdateInput = { ...rest };

    const recurrence = 'recurrence' in data ? data.recurrence : current.recurrence;
    const dueDate = 'dueDate' in data ? data.dueDate : current.dueDate;
    if (recurrence && !dueDate) {
      throw new BadRequestException('A recurring task needs a start date (dueDate).');
    }
    if (recurrence) {
      data = { ...data, status: TaskStatus.backlog, todayDate: null };
    } else {
      const promo = this.dueTodayPromotion(
        ('dueDate' in data ? data.dueDate : current.dueDate) as Prisma.TaskUncheckedCreateWithoutBoardInput['dueDate'],
        (data.status as TaskStatus) ?? current.status,
        today
      );
      if (promo) data = { ...data, ...promo };
    }

    if (typeof data.status === 'string' && data.status !== current.status) {
      data.completedAt = data.status === TaskStatus.done ? new Date() : null;
      // The check-in belongs to the completion: reopening a task discards it.
      if (data.status !== TaskStatus.done) data = { ...data, feeling: null, actualMinutes: null };
      // Entering Today stamps the day it was taken in work (drives rollover and the calendar).
      if (data.status === TaskStatus.today && !('todayDate' in dto)) data.todayDate = startOfUTCDay(today);
    }
    return this.prisma.task.update({ where: { id }, data });
  }

  /**
   * Resolves a recurring task's flagged missed occurrence (always the single
   * entry in missedDates — see the field comment on the schema). Doesn't touch
   * the series' recurrence/recurrenceEndDate.
   */
  private resolveMissed(task: Task, action: ResolveMissedAction) {
    const missed = task.missedDates[0];
    if (!missed) return task;

    const data: Prisma.TaskUncheckedUpdateInput = { missedDates: [], lastResolvedMissedOccurrence: missed };
    switch (action) {
      case ResolveMissedAction.done:
        data.completedDates = [...task.completedDates, missed];
        break;
      case ResolveMissedAction.addToday:
        data.extraTodayDates = [...task.extraTodayDates, startOfUTCDay(new Date())];
        break;
      case ResolveMissedAction.dismiss:
        break;
    }
    return this.prisma.task.update({ where: { id: task.id }, data });
  }

  private async toggleOccurrence(id: string, isoDate: string, done: boolean) {
    const day = startOfUTCDay(new Date(isoDate));
    const task = await this.prisma.task.findUnique({ where: { id } });
    const others = (task?.completedDates ?? []).filter((d) => startOfUTCDay(d).getTime() !== day.getTime());
    return this.prisma.task.update({
      where: { id },
      data: { completedDates: done ? [...others, day] : others },
    });
  }

  async remove(id: string, boardId?: string) {
    await this.findOne(id, boardId);
    await this.prisma.task.delete({ where: { id } });
  }
}
