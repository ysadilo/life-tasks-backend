import { Feeling, Recurrence, TaskStatus } from '@prisma/client';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';

const prisma = {
  task: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn((args) => args.data),
    updateMany: jest.fn(),
    create: jest.fn((args) => args.data),
  },
} as unknown as PrismaService;

const service = new TasksService(prisma);

beforeEach(() => jest.clearAllMocks());

describe('TasksService.update completedAt', () => {
  it('stamps completedAt when a task moves to done', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', status: TaskStatus.today });
    const data = await service.update('1', { status: TaskStatus.done });
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('clears completedAt when a done task moves elsewhere', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', status: TaskStatus.done });
    const data = await service.update('1', { status: TaskStatus.today });
    expect(data.completedAt).toBeNull();
  });

  it('stamps todayDate when a task enters Today', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', status: TaskStatus.needs_triage });
    const data = await service.update('1', { status: TaskStatus.today });
    expect(data.todayDate).toBeInstanceOf(Date);
  });

  it('leaves completedAt untouched when status does not change', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', status: TaskStatus.done });
    const data = await service.update('1', { title: 'renamed' });
    expect('completedAt' in data).toBe(false);
  });
});

describe('TasksService.update reflection', () => {
  it('stores the check-in sent with the move to done', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', status: TaskStatus.today });
    const data = await service.update('1', { status: TaskStatus.done, feeling: Feeling.good, actualMinutes: 60 });
    expect(data).toMatchObject({ feeling: Feeling.good, actualMinutes: 60 });
  });

  it('discards the check-in when a done task is reopened', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', status: TaskStatus.done });
    const data = await service.update('1', { status: TaskStatus.today });
    expect(data).toMatchObject({ feeling: null, actualMinutes: null });
  });
});

describe('TasksService recurring series', () => {
  it('keeps a recurring series off the boards (forced to backlog on create)', () => {
    service.create('b1', {
      title: 'Water plants',
      recurrence: Recurrence.daily,
      dueDate: '2026-09-01',
      status: TaskStatus.today,
    });
    const data = (prisma.task.create as jest.Mock).mock.calls[0][0].data;
    expect(data.status).toBe(TaskStatus.backlog);
    expect(data.todayDate).toBeNull();
  });

  it('ticks an occurrence day into completedDates', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', completedDates: [] });
    await service.update('1', { occurrenceDate: '2026-09-03', occurrenceDone: true });
    const data = (prisma.task.update as jest.Mock).mock.calls.at(-1)[0].data;
    expect(data.completedDates).toHaveLength(1);
    expect(data.completedDates[0].toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('unticks an occurrence day', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: '1',
      completedDates: [new Date('2026-09-03T00:00:00.000Z'), new Date('2026-09-04T00:00:00.000Z')],
    });
    await service.update('1', { occurrenceDate: '2026-09-03', occurrenceDone: false });
    const data = (prisma.task.update as jest.Mock).mock.calls.at(-1)[0].data;
    expect(data.completedDates.map((d: Date) => d.toISOString())).toEqual(['2026-09-04T00:00:00.000Z']);
  });

  it('does not double-add an already-ticked day', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: '1',
      completedDates: [new Date('2026-09-03T00:00:00.000Z')],
    });
    await service.update('1', { occurrenceDate: '2026-09-03', occurrenceDone: true });
    const data = (prisma.task.update as jest.Mock).mock.calls.at(-1)[0].data;
    expect(data.completedDates).toHaveLength(1);
  });
});

describe('TasksService due-today promotion', () => {
  const todayISO = new Date().toISOString().slice(0, 10);

  it('promotes a one-off task due today to Today on create', () => {
    service.create('b1', { title: 'Call bank', dueDate: todayISO, status: TaskStatus.backlog });
    const data = (prisma.task.create as jest.Mock).mock.calls[0][0].data;
    expect(data.status).toBe(TaskStatus.today);
    expect(data.todayDate).toBeInstanceOf(Date);
  });

  it('leaves a future-dated task in the backlog', () => {
    service.create('b1', { title: 'Later', dueDate: '2099-01-01', status: TaskStatus.backlog });
    const data = (prisma.task.create as jest.Mock).mock.calls[0][0].data;
    expect(data.status).toBe(TaskStatus.backlog);
  });

  it('promotes on update when a backlog task is edited to a due date of today', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', status: TaskStatus.backlog, dueDate: null });
    const data = await service.update('1', { dueDate: todayISO });
    expect(data.status).toBe(TaskStatus.today);
  });
});

describe('TasksService recurrence needs a start date', () => {
  it('rejects creating a recurring task without a dueDate', () => {
    expect(() => service.create('b1', { title: 'x', recurrence: Recurrence.daily })).toThrow(/start date/);
  });

  it('rejects adding recurrence to a task that has no dueDate', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ id: '1', status: TaskStatus.backlog, dueDate: null });
    await expect(service.update('1', { recurrence: Recurrence.weekly })).rejects.toThrow(/start date/);
  });

  it('allows recurrence when the task already has a dueDate', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({
      id: '1',
      status: TaskStatus.backlog,
      dueDate: new Date('2026-09-01'),
    });
    await expect(service.update('1', { recurrence: Recurrence.weekly })).resolves.toBeDefined();
  });
});

describe('TasksService areaId', () => {
  it('passes areaId through to prisma as a scalar, not a relation connect', () => {
    const data = service.create('b1', { title: 'x', areaId: 'area1' });
    expect(data).toMatchObject({ boardId: 'b1', areaId: 'area1' });
  });
});

describe('TasksService today→triage rollover', () => {
  it('rolls a stale, undone Today task to needs_triage when `today` is passed', async () => {
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]); // no recurring series
    await service.findMany({ boardId: 'b1', today: new Date('2026-09-22') });

    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        boardId: 'b1',
        status: TaskStatus.today,
        recurrence: null,
        OR: [{ todayDate: null }, { todayDate: { lt: new Date('2026-09-22T00:00:00.000Z') } }],
      },
      data: { status: TaskStatus.needs_triage },
    });
  });

  it('promotes due backlog tasks to Today when `today` is passed', async () => {
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
    await service.findMany({ boardId: 'b1', today: new Date('2026-09-22') });

    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        boardId: 'b1',
        status: TaskStatus.backlog,
        recurrence: null,
        dueDate: { lte: new Date('2026-09-22T00:00:00.000Z') },
      },
      data: { status: TaskStatus.today, todayDate: new Date('2026-09-22T00:00:00.000Z') },
    });
  });

  it('does nothing when `today` is not passed', async () => {
    await service.findMany({ boardId: 'b1' });
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });
});

describe('TasksService recurring missed-occurrence detection', () => {
  const today = new Date('2026-09-22');

  it('flags the last undone occurrence as missed once the series has no occurrence today', async () => {
    (prisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        // Weekly from Sep 10 → occurrences Sep 10, 17, 24. Sep 22 isn't one of
        // them, so the last occurrence (Sep 17) should be flagged as missed.
        id: 'r1',
        recurrence: Recurrence.weekly,
        dueDate: new Date('2026-09-10'),
        recurrenceEndDate: null,
        completedDates: [],
        missedDates: [],
      },
    ]);
    await service.findMany({ boardId: 'b1', today });

    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { missedDates: [new Date('2026-09-17T00:00:00.000Z')] },
    });
  });

  it('does not flag a daily task — it already has an occurrence today', async () => {
    (prisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'r2',
        recurrence: Recurrence.daily,
        dueDate: new Date('2026-09-01'),
        recurrenceEndDate: null,
        completedDates: [],
        missedDates: [],
      },
    ]);
    await service.findMany({ boardId: 'b1', today });
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('auto-clears a stale missed flag once the series has an occurrence today again', async () => {
    (prisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'r3',
        recurrence: Recurrence.daily,
        dueDate: new Date('2026-09-01'),
        recurrenceEndDate: null,
        completedDates: [],
        missedDates: [new Date('2026-09-20')],
      },
    ]);
    await service.findMany({ boardId: 'b1', today });
    expect(prisma.task.update).toHaveBeenCalledWith({ where: { id: 'r3' }, data: { missedDates: [] } });
  });

  it('does not re-flag a task that already has an unresolved missed occurrence', async () => {
    (prisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        // Weekly from Sep 2 → Sep 22 isn't an occurrence day, so this would
        // otherwise be (re-)flagged if the existing missedDates weren't respected.
        id: 'r4',
        recurrence: Recurrence.weekly,
        dueDate: new Date('2026-09-02'),
        recurrenceEndDate: null,
        completedDates: [],
        missedDates: [new Date('2026-09-16')],
      },
    ]);
    await service.findMany({ boardId: 'b1', today });
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('does not flag an occurrence that was actually completed', async () => {
    (prisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        // Weekly from Sep 3 → last occurrence before Sep 22 is Sep 17, already completed.
        id: 'r5',
        recurrence: Recurrence.weekly,
        dueDate: new Date('2026-09-03'),
        recurrenceEndDate: null,
        completedDates: [new Date('2026-09-17')],
        missedDates: [],
      },
    ]);
    await service.findMany({ boardId: 'b1', today });
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('does not re-flag a missed occurrence that was already dismissed or added to today', async () => {
    // Regression: resolving used to clear missedDates without recording that
    // the occurrence was handled, so the very next detection pass immediately
    // re-flagged the same date — dismiss/add-to-today never actually stuck.
    (prisma.task.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'r6',
        recurrence: Recurrence.weekly,
        dueDate: new Date('2026-09-10'),
        recurrenceEndDate: null,
        completedDates: [],
        missedDates: [],
        lastResolvedMissedOccurrence: new Date('2026-09-17'), // already dismissed/added-to-today
      },
    ]);
    await service.findMany({ boardId: 'b1', today });
    expect(prisma.task.update).not.toHaveBeenCalled();
  });
});

describe('TasksService resolving a missed occurrence', () => {
  const recurringTask = {
    id: 'r1',
    status: TaskStatus.backlog,
    recurrence: Recurrence.weekly,
    completedDates: [] as Date[],
    extraTodayDates: [] as Date[],
    missedDates: [new Date('2026-09-15T00:00:00.000Z')],
  };

  it('marks the missed occurrence done retroactively', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue(recurringTask);
    const data = await service.update('r1', { resolveMissedAction: 'done' } as never);
    expect(data.completedDates).toEqual([new Date('2026-09-15T00:00:00.000Z')]);
    expect(data.missedDates).toEqual([]);
    expect(data.lastResolvedMissedOccurrence).toEqual(new Date('2026-09-15T00:00:00.000Z'));
  });

  it('dismisses the missed occurrence without completing it, but still records it as resolved', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue(recurringTask);
    const data = await service.update('r1', { resolveMissedAction: 'dismiss' } as never);
    expect(data.completedDates).toBeUndefined();
    expect(data.missedDates).toEqual([]);
    expect(data.lastResolvedMissedOccurrence).toEqual(new Date('2026-09-15T00:00:00.000Z'));
  });

  it('adds the missed task to today without touching the recurrence schedule, and records it as resolved', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue(recurringTask);
    const data = await service.update('r1', { resolveMissedAction: 'addToday' } as never);
    expect(data.extraTodayDates).toHaveLength(1);
    expect(data.missedDates).toEqual([]);
    expect(data.recurrence).toBeUndefined();
    expect(data.lastResolvedMissedOccurrence).toEqual(new Date('2026-09-15T00:00:00.000Z'));
  });

  it('is a no-op when there is nothing flagged as missed', async () => {
    (prisma.task.findUnique as jest.Mock).mockResolvedValue({ ...recurringTask, missedDates: [] });
    const data = await service.update('r1', { resolveMissedAction: 'dismiss' } as never);
    expect(data).toEqual({ ...recurringTask, missedDates: [] });
  });
});
