import { Prisma, AgentActionKind, AgentConnection, AgentPermission, Task, TaskStatus } from '@prisma/client';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { AgentActionInput, AgentsService } from './agents.service';
import type { UpdateTaskDto } from '../tasks/task.dto';
import { hasOccurrenceOn, isOccurrenceDone } from '../tasks/recurrence.util';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const priority = z.enum(['P1', 'P2', 'P3', 'P4']);
const energy = z.enum(['low', 'medium', 'high']);
const date = day
  .optional()
  .describe("The user's current date (YYYY-MM-DD). Defaults to today in UTC; pass it if you know it.");
const board = z.string().optional().describe('Board id or name. Defaults to the first board enabled for you.');

const DAY_MS = 24 * 3600_000;
const startOfUTCDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Deps {
  prisma: PrismaService;
  tasks: TasksService;
  activity: ActivityService;
  agents: AgentsService;
}

interface AgentBoard {
  id: string;
  name: string;
  shared: boolean;
}

/**
 * The MCP tools one connected agent may call, scoped to that agent's permissions
 * and boards. Built per request, so a permission changed in Settings applies to
 * the agent's very next call.
 */
export class AgentToolkit {
  private boardsPromise?: Promise<AgentBoard[]>;

  constructor(
    private readonly deps: Deps,
    private readonly userId: string,
    private readonly connection: AgentConnection
  ) {}

  private get can() {
    return new Set<AgentPermission>(this.connection.permissions);
  }

  private need(permission: AgentPermission) {
    if (!this.can.has(permission)) {
      throw new Error(
        `The "${permission}" permission is off for ${this.connection.name}. Ask the user to turn it on in Life Tasks › Settings › AI agents.`
      );
    }
  }

  /** Enabled boards the user is still a member of. */
  private boards(): Promise<AgentBoard[]> {
    this.boardsPromise ??= this.deps.prisma.board.findMany({
      where: { id: { in: this.connection.boardIds }, members: { some: { userId: this.userId } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, shared: true },
    });
    return this.boardsPromise;
  }

  private async resolveBoard(ref?: string): Promise<AgentBoard> {
    const boards = await this.boards();
    if (boards.length === 0) {
      throw new Error('No boards are enabled for this agent. Ask the user to enable one in Settings › AI agents.');
    }
    if (!ref) return boards[0];
    const found = boards.find((b) => b.id === ref || b.name.toLowerCase() === ref.toLowerCase());
    if (!found) throw new Error(`Unknown board "${ref}". Enabled boards: ${boards.map((b) => b.name).join(', ')}.`);
    return found;
  }

  private async resolveArea(boardId: string, name: string) {
    const areas = await this.deps.prisma.lifeArea.findMany({ where: { boardId }, select: { id: true, name: true } });
    const found = areas.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (!found) throw new Error(`Unknown area "${name}". Areas on this board: ${areas.map((a) => a.name).join(', ')}.`);
    return found.id;
  }

  private async areaNames(boardIds: string[]) {
    const areas = await this.deps.prisma.lifeArea.findMany({ where: { boardId: { in: boardIds } } });
    return new Map(areas.map((a) => [a.id, a.name]));
  }

  /** A task on an enabled board; anything else reads as not found so other boards don't leak. */
  private async ownTask(id: string, { allowRecurring = false } = {}): Promise<Task> {
    const task = await this.deps.tasks.findOne(id).catch(() => null);
    const boards = await this.boards();
    if (!task || !boards.some((b) => b.id === task.boardId)) throw new Error(`Task ${id} not found.`);
    if (task.recurrence && !allowRecurring) {
      throw new Error(
        'Recurring tasks can be read and ticked off for a day, but not changed or deleted by agents yet.'
      );
    }
    return task;
  }

  /** The user's calendar day an agent means; UTC midnight. */
  private dayOf(value?: string): Date {
    return value ? new Date(`${value}T00:00:00Z`) : startOfUTCDay(new Date());
  }

  /** A recurring series as one of `day`'s tasks. */
  private briefOccurrence(task: Task, areas: Map<string, string>, on: Date) {
    return {
      ...this.brief(task, areas),
      status: TaskStatus.today,
      recurring: true,
      recurrence: task.recurrence,
      occurrenceDate: isoDay(on),
      done: isOccurrenceDone(task, on),
    };
  }

  /** Ticks off a recurring task's occurrence on `day`; the series itself stays open. */
  private async completeOccurrence(task: Task, day: Date) {
    const on = isoDay(day) as string;
    if (!hasOccurrenceOn(task, day)) throw new Error(`"${task.title}" is not scheduled on ${on}.`);
    const areas = await this.areaNames([task.boardId]);
    if (isOccurrenceDone(task, day))
      return this.reply({ ...this.briefOccurrence(task, areas, day), note: 'Already ticked off.' });

    const dto = { occurrenceDate: on, occurrenceDone: true } as UpdateTaskDto;
    const updated = await this.deps.tasks.update(task.id, dto, task.boardId);
    await this.deps.activity.recordUpdate(task.boardId, this.userId, task, updated, dto);
    await this.log({
      kind: 'done',
      boardId: task.boardId,
      taskId: task.id,
      taskTitle: task.title,
      detail: `for ${on}`,
    });
    return this.reply(this.briefOccurrence(updated, areas, day));
  }

  private brief(task: Task, areas: Map<string, string>) {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      dueDate: isoDay(task.dueDate),
      priority: task.priority,
      energy: task.energy,
      estimatedMinutes: task.estimatedMinutes,
      area: (task.areaId && areas.get(task.areaId)) ?? null,
    };
  }

  private async log(...actions: AgentActionInput[]) {
    await this.deps.agents.record(this.connection.id, actions);
  }

  private reply(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  }

  private statusLabel(task: Task) {
    return task.status === TaskStatus.today ? 'Today' : task.status === TaskStatus.done ? 'Done' : 'Backlog';
  }

  register(server: McpServer) {
    const { tasks, activity } = this.deps;
    const action = (kind: AgentActionKind, task: Task, detail?: string): AgentActionInput => ({
      kind,
      boardId: task.boardId,
      taskId: task.id,
      taskTitle: task.title,
      detail,
    });

    server.registerTool(
      'list_boards',
      { description: 'Boards this agent may use, with their life areas.' },
      async () => {
        this.need('read');
        const boards = await this.boards();
        const areas = await this.deps.prisma.lifeArea.findMany({
          where: { boardId: { in: boards.map((b) => b.id) } },
          orderBy: { order: 'asc' },
        });
        return this.reply(
          boards.map((b) => ({ ...b, areas: areas.filter((a) => a.boardId === b.id).map((a) => a.name) }))
        );
      }
    );

    server.registerTool(
      'list_tasks',
      {
        description:
          "Tasks on a board: Today, backlog, done, or a due-date range. status 'today' also includes recurring tasks " +
          '(daily, weekly…) that occur on `date` and are not ticked off yet; they have recurring: true and an occurrenceDate.',
        inputSchema: {
          board,
          status: z.enum(['today', 'backlog', 'needs_triage', 'done']).optional(),
          date,
          from: day.optional().describe('Only tasks due, done or planned on/after this day.'),
          to: day.optional().describe('Only tasks due, done or planned on/before this day.'),
        },
      },
      async ({ board: ref, status, date: on, from, to }) => {
        this.need('read');
        const b = await this.resolveBoard(ref);
        const found = await tasks.findMany({
          boardId: b.id,
          status: status as TaskStatus | undefined,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        });
        const areas = await this.areaNames([b.id]);
        const list: object[] = found.map((t) => this.brief(t, areas));
        if (status === TaskStatus.today) {
          // Recurring series are one row each; the app works out which fall on the day, and so do we.
          const day = this.dayOf(on);
          const series = await tasks.findMany({ boardId: b.id, recurring: true });
          list.push(
            ...series
              .filter((t) => hasOccurrenceOn(t, day) && !isOccurrenceDone(t, day))
              .map((t) => this.briefOccurrence(t, areas, day))
          );
        }
        const label = status ? status[0].toUpperCase() + status.slice(1).replace('_', ' ') : 'All tasks';
        await this.log({ kind: 'read', boardId: b.id, detail: `${label} (${plural(list.length, 'task')})` });
        return this.reply(list);
      }
    );

    server.registerTool(
      'get_task',
      { description: 'One task with its notes and check-in.', inputSchema: { id: z.string() } },
      async ({ id }) => {
        this.need('read');
        const task = await this.ownTask(id, { allowRecurring: true });
        const areas = await this.areaNames([task.boardId]);
        await this.log({ kind: 'read', boardId: task.boardId, detail: `"${task.title}"` });
        return this.reply({
          ...this.brief(task, areas),
          ...(task.recurrence && {
            recurring: true,
            recurrence: task.recurrence,
            recurrenceInterval: task.recurrenceInterval,
            recurrenceUnit: task.recurrenceUnit,
            recurrenceEndDate: isoDay(task.recurrenceEndDate),
            completedDates: task.completedDates.map((d) => isoDay(d)),
          }),
          feeling: task.feeling,
          actualMinutes: task.actualMinutes,
          completedAt: task.completedAt,
        });
      }
    );

    server.registerTool(
      'create_task',
      {
        description:
          'Add a task. Resolve natural dates ("Saturday") to YYYY-MM-DD yourself. A task due today goes on Today.',
        inputSchema: {
          board,
          title: z.string().trim().min(1).max(200),
          description: z.string().max(5000).optional(),
          dueDate: day.optional(),
          area: z.string().optional().describe('Life area name, e.g. "Health".'),
          priority: priority.optional(),
          energy: energy.optional(),
          estimatedMinutes: z.number().int().min(1).max(1440).optional(),
        },
      },
      async ({ board: ref, area, dueDate, ...fields }) => {
        this.need('add');
        const b = await this.resolveBoard(ref);
        const task = await tasks.create(b.id, {
          ...fields,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          areaId: area ? await this.resolveArea(b.id, area) : undefined,
          createdVia: this.connection.name,
        });
        await activity.recordAdded(b.id, this.userId, task);
        const areaName = task.areaId ? (await this.areaNames([b.id])).get(task.areaId) : undefined;
        const detail = [
          `to ${this.statusLabel(task)}`,
          task.priority,
          task.estimatedMinutes && `${task.estimatedMinutes}m`,
          areaName,
        ]
          .filter(Boolean)
          .join(' · ');
        await this.log(action('added', task, detail));
        return this.reply(this.brief(task, new Map(task.areaId && areaName ? [[task.areaId, areaName]] : [])));
      }
    );

    server.registerTool(
      'update_task',
      {
        description:
          "Change a task's details. Pass dueDate: null to clear it. To move it between Today and Backlog use move_task.",
        inputSchema: {
          id: z.string(),
          title: z.string().trim().min(1).max(200).optional(),
          description: z.string().max(5000).nullable().optional(),
          dueDate: day.nullable().optional(),
          area: z.string().optional().describe('Life area name.'),
          priority: priority.optional(),
          energy: energy.optional(),
          estimatedMinutes: z.number().int().min(1).max(1440).optional(),
        },
      },
      async ({ id, area, ...fields }) => {
        this.need('edit');
        const before = await this.ownTask(id);
        const dto = {
          ...fields,
          ...(area ? { areaId: await this.resolveArea(before.boardId, area) } : {}),
        } as UpdateTaskDto;
        const after = await tasks.update(id, dto, before.boardId);
        await this.log(
          action(
            'edited',
            after,
            Object.keys(fields)
              .concat(area ? ['area'] : [])
              .join(', ')
          )
        );
        return this.reply(this.brief(after, await this.areaNames([after.boardId])));
      }
    );

    server.registerTool(
      'move_task',
      {
        description: 'Move a task to Today, to the Backlog, or reschedule it to a day (YYYY-MM-DD).',
        inputSchema: { id: z.string(), to: z.union([z.enum(['today', 'backlog']), day]) },
      },
      async ({ id, to }) => {
        this.need('edit');
        const before = await this.ownTask(id);
        const dto: UpdateTaskDto =
          to === 'today'
            ? { status: TaskStatus.today }
            : to === 'backlog'
              ? { status: TaskStatus.backlog }
              : { dueDate: to, status: TaskStatus.backlog };
        const after = await tasks.update(id, dto, before.boardId);
        await this.log(action('moved', after, `to ${to === 'today' ? 'Today' : to === 'backlog' ? 'Backlog' : to}`));
        return this.reply(this.brief(after, await this.areaNames([after.boardId])));
      }
    );

    server.registerTool(
      'complete_task',
      {
        description:
          'Mark a task done, optionally with how it felt and the time it took. For a recurring task this ticks ' +
          'off the occurrence on `date` (how it felt and the time are not recorded for those).',
        inputSchema: {
          id: z.string(),
          date,
          feeling: z.enum(['drained', 'heavy', 'neutral', 'good', 'great']).optional(),
          actualMinutes: z.number().int().min(1).max(1440).optional(),
        },
      },
      async ({ id, date: on, ...checkIn }) => {
        this.need('done');
        const before = await this.ownTask(id, { allowRecurring: true });
        if (before.recurrence) return this.completeOccurrence(before, this.dayOf(on));
        const dto = { status: TaskStatus.done, ...checkIn } as UpdateTaskDto;
        const updated = await tasks.update(id, dto, before.boardId);
        const after = await this.deps.prisma.task.update({
          where: { id },
          data: { completedVia: this.connection.name },
        });
        await activity.recordUpdate(before.boardId, this.userId, before, updated, dto);
        await this.log(action('done', after));
        return this.reply(this.brief(after, await this.areaNames([after.boardId])));
      }
    );

    server.registerTool(
      'delete_task',
      {
        description: 'Permanently delete a task. This cannot be undone.',
        inputSchema: { id: z.string() },
      },
      async ({ id }) => {
        this.need('delete');
        const task = await this.ownTask(id);
        await tasks.remove(id, task.boardId);
        await this.log(action('deleted', task));
        return this.reply({ deleted: id });
      }
    );

    server.registerTool(
      'get_triage',
      {
        description: "Yesterday's leftovers: Today tasks that were not finished and wait to be sorted.",
        inputSchema: { board },
      },
      async ({ board: ref }) => {
        this.need('read');
        const b = await this.resolveBoard(ref);
        const found = await tasks.findMany({ boardId: b.id, status: TaskStatus.needs_triage });
        await this.log({ kind: 'read', boardId: b.id, detail: `Triage (${plural(found.length, 'task')})` });
        return this.reply(found.map((t) => this.brief(t, new Map())));
      }
    );

    server.registerTool(
      'triage_task',
      {
        description: 'Sort one leftover into Today, Backlog, Done, or drop (delete) it.',
        inputSchema: { id: z.string(), action: z.enum(['today', 'backlog', 'done', 'drop']) },
      },
      async ({ id, action: choice }) => {
        this.need('triage');
        const before = await this.ownTask(id);
        if (before.status !== TaskStatus.needs_triage) throw new Error('That task is not waiting in triage.');
        if (choice === 'drop') {
          await tasks.remove(id, before.boardId);
          await this.log(action('triaged', before, 'dropped'));
          return this.reply({ dropped: id });
        }
        const dto: UpdateTaskDto = { status: choice as TaskStatus };
        const after = await tasks.update(id, dto, before.boardId);
        if (choice === 'done') {
          await this.deps.prisma.task.update({ where: { id }, data: { completedVia: this.connection.name } });
        }
        await this.log(action('triaged', after, `to ${choice[0].toUpperCase() + choice.slice(1)}`));
        return this.reply(this.brief(after, await this.areaNames([after.boardId])));
      }
    );

    server.registerTool(
      'get_stats',
      { description: "Streak, this week's finished count and open load by life area.", inputSchema: { board } },
      async ({ board: ref }) => {
        this.need('read');
        const b = await this.resolveBoard(ref);
        const today = startOfUTCDay(new Date());
        const since = new Date(today.getTime() - 60 * DAY_MS);
        const [done, open] = await Promise.all([
          this.deps.prisma.task.findMany({
            where: { boardId: b.id, status: TaskStatus.done, completedAt: { gte: since } },
            select: { completedAt: true },
          }),
          this.deps.prisma.task.groupBy({
            by: ['areaId'],
            where: {
              boardId: b.id,
              recurrence: null,
              status: { not: TaskStatus.done },
            } satisfies Prisma.TaskWhereInput,
            _count: true,
          }),
        ]);
        const doneDays = new Set(done.map((t) => startOfUTCDay(t.completedAt as Date).getTime()));
        // The streak survives today being unfinished so far: count back from yesterday then.
        let cursor = doneDays.has(today.getTime()) ? today.getTime() : today.getTime() - DAY_MS;
        let streak = 0;
        for (; doneDays.has(cursor); cursor -= DAY_MS) streak++;
        const areas = await this.areaNames([b.id]);
        await this.log({ kind: 'read', boardId: b.id, detail: 'Stats' });
        return this.reply({
          streakDays: streak,
          doneLast7Days: done.filter((t) => (t.completedAt as Date).getTime() >= today.getTime() - 6 * DAY_MS).length,
          openByArea: open.map((o) => ({ area: (o.areaId && areas.get(o.areaId)) ?? 'No area', open: o._count })),
        });
      }
    );
  }
}
