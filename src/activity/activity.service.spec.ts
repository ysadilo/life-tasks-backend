import { ActivityType, Task, TaskStatus } from '@prisma/client';
import { ActivityService, eventsForUpdate } from './activity.service';
import { PrismaService } from '../prisma/prisma.service';

const task = (over: Partial<Task>) =>
  ({ id: 't', title: 'Pay bill', status: TaskStatus.today, assigneeId: null, ...over }) as Task;

describe('eventsForUpdate', () => {
  it('reports finishing and re-assigning separately', () => {
    const events = eventsForUpdate(task({}), task({ status: TaskStatus.done, assigneeId: 'u2' }), {});
    expect(events).toEqual([{ type: ActivityType.finished }, { type: ActivityType.assigned, targetUserId: 'u2' }]);
  });

  it('ticking a recurring occurrence counts as finished, unticking does not', () => {
    expect(eventsForUpdate(task({}), task({}), { occurrenceDate: '2026-10-24', occurrenceDone: true })).toHaveLength(1);
    expect(eventsForUpdate(task({}), task({}), { occurrenceDate: '2026-10-24', occurrenceDone: false })).toHaveLength(
      0
    );
  });

  it('records nothing for an unrelated edit, and unassigning targets null', () => {
    expect(eventsForUpdate(task({}), task({ title: 'x' }), { title: 'x' })).toEqual([]);
    expect(eventsForUpdate(task({ assigneeId: 'u1' }), task({ assigneeId: null }), {})).toEqual([
      { type: ActivityType.assigned, targetUserId: null },
    ]);
  });
});

describe('ActivityService.recordAdded', () => {
  const service = (shared: boolean) => {
    const createMany = jest.fn();
    const prisma = {
      board: { findUnique: jest.fn().mockResolvedValue({ shared }) },
      activity: { createMany },
    } as unknown as PrismaService;
    return { createMany, service: new ActivityService(prisma) };
  };

  it('logs on a shared board', async () => {
    const { createMany, service: s } = service(true);
    await s.recordAdded('b1', 'u1', task({ title: 'Book boiler' }));
    expect(createMany).toHaveBeenCalledWith({
      data: [{ boardId: 'b1', actorId: 'u1', taskTitle: 'Book boiler', type: 'added', targetUserId: null }],
    });
  });

  it('stays silent on a personal board', async () => {
    const { createMany, service: s } = service(false);
    await s.recordAdded('b1', 'u1', task({}));
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe('ActivityService failures', () => {
  it('never throws when the feed cannot be written', async () => {
    const prisma = {
      board: { findUnique: jest.fn().mockResolvedValue({ shared: true }) },
      activity: { createMany: jest.fn().mockRejectedValue(new Error('relation "Activity" does not exist')) },
    } as unknown as PrismaService;
    await expect(new ActivityService(prisma).recordAdded('b1', 'u1', task({}))).resolves.toBeUndefined();
  });
});
