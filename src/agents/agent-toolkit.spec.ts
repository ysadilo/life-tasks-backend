import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AgentConnection } from '@prisma/client';
import { AgentToolkit } from './agent-toolkit';

const connection = (over: Partial<AgentConnection> = {}): AgentConnection => ({
  id: 'c1',
  userId: 'u1',
  clientId: 'client',
  name: 'Claude',
  permissions: ['read', 'add'],
  boardIds: ['b1'],
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  ...over,
});

async function connect(conn: AgentConnection) {
  const task = { id: 't1', boardId: 'b1', title: 'Book flights', status: 'backlog', areaId: 'a1', priority: 'P2' };
  const deps = {
    prisma: {
      board: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Yana', shared: false }]) },
      lifeArea: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', boardId: 'b1', name: 'Social' }]) },
      task: { update: jest.fn() },
      boardMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u2', user: { email: 'Ann@x.com' } }]),
      },
    },
    tasks: {
      create: jest.fn().mockResolvedValue(task),
      findOne: jest.fn().mockResolvedValue(task),
      remove: jest.fn(),
      findMany: jest.fn().mockResolvedValue([task]),
      update: jest.fn(),
    },
    activity: { recordAdded: jest.fn(), recordUpdate: jest.fn() },
    agents: { record: jest.fn() },
  };
  const server = new McpServer({ name: 'test', version: '0' });
  new AgentToolkit(deps as never, 'u1', conn).register(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<{ isError?: boolean; content: { text: string }[] }>;
  return { deps, call, client };
}

describe('AgentToolkit', () => {
  it('exposes the tools', async () => {
    const { client } = await connect(connection());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['list_tasks', 'create_task', 'complete_task', 'triage_task', 'get_stats', 'delete_task'])
    );
  });

  it('adds a task labelled with the agent, resolves the area by name and logs it', async () => {
    const { deps, call } = await connect(connection());
    const result = await call('create_task', { title: 'Book flights', area: 'social', priority: 'P2' });

    expect(result.isError).toBeFalsy();
    expect(deps.tasks.create).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ title: 'Book flights', areaId: 'a1', createdVia: 'Claude' })
    );
    expect(deps.agents.record).toHaveBeenCalledWith('c1', [
      expect.objectContaining({ kind: 'added', detail: 'to Backlog · P2 · Social' }),
    ]);
  });

  it('assigns a board member by email and rejects a stranger', async () => {
    const { deps, call } = await connect(connection({ permissions: ['read', 'add', 'edit'] }));
    deps.tasks.update.mockResolvedValue({ id: 't1', boardId: 'b1', title: 'x' });

    await call('create_task', { title: 'Pack', assignee: 'ann@x.com' });
    expect(deps.tasks.create).toHaveBeenCalledWith('b1', expect.objectContaining({ assigneeId: 'u2' }));

    await call('update_task', { id: 't1', assignee: null });
    expect(deps.tasks.update).toHaveBeenCalledWith('t1', expect.objectContaining({ assigneeId: null }), 'b1');

    expect((await call('update_task', { id: 't1', assignee: 'bob@x.com' })).isError).toBe(true);
  });

  it('refuses a tool whose permission is off, without touching anything', async () => {
    const { deps, call } = await connect(connection());
    const result = await call('delete_task', { id: 't1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"delete" permission is off');
    expect(deps.tasks.remove).not.toHaveBeenCalled();
  });

  it('treats a task on a board the agent was not given as not found', async () => {
    const { deps, call } = await connect(connection({ permissions: ['read', 'delete'] }));
    deps.tasks.findOne.mockResolvedValue({ id: 't9', boardId: 'other', title: 'Secret' });
    const result = await call('delete_task', { id: 't9' });

    expect(result.isError).toBe(true);
    expect(deps.tasks.remove).not.toHaveBeenCalled();
  });

  it('rejects malformed input before reaching the service', async () => {
    const { deps, call } = await connect(connection());
    expect((await call('create_task', { title: '  ' })).isError).toBe(true);
    expect((await call('create_task', { title: 'x', priority: 'P9' })).isError).toBe(true);
    expect(deps.tasks.create).not.toHaveBeenCalled();
  });

  describe('recurring tasks', () => {
    const series = (over: Record<string, unknown>) => ({
      id: 'r1',
      boardId: 'b1',
      title: 'Vitamin D',
      status: 'backlog',
      recurrence: 'daily',
      dueDate: new Date('2026-10-01T00:00:00Z'),
      recurrenceEndDate: null,
      completedDates: [],
      extraTodayDates: [],
      areaId: null,
      ...over,
    });
    const TODAY = '2026-10-28';

    it("lists today's recurring tasks that are not ticked off, next to the one-off ones", async () => {
      const { deps, call } = await connect(connection());
      const daily = series({ id: 'r1', title: 'Vitamin D' });
      const doneToday = series({ id: 'r2', title: 'Reading', completedDates: [new Date(`${TODAY}T00:00:00Z`)] });
      const weekly = series({ id: 'r3', title: 'Laundry', recurrence: 'weekly' }); // 1, 8, 15, 22, 29 Oct
      deps.tasks.findMany.mockImplementation(async (filter: { recurring?: boolean }) =>
        filter.recurring
          ? [daily, doneToday, weekly]
          : [{ id: 't1', boardId: 'b1', title: 'Pay rent', status: 'today' }]
      );

      const result = await call('list_tasks', { status: 'today', date: TODAY });
      const tasks = JSON.parse(result.content[0].text) as {
        title: string;
        recurring?: boolean;
        occurrenceDate?: string;
      }[];

      expect(tasks.map((t) => t.title)).toEqual(['Pay rent', 'Vitamin D']);
      expect(tasks[1]).toMatchObject({ recurring: true, recurrence: 'daily', occurrenceDate: TODAY, status: 'today' });
    });

    it("doesn't pull recurring tasks into other lists", async () => {
      const { deps, call } = await connect(connection());
      await call('list_tasks', { status: 'backlog' });
      expect(deps.tasks.findMany).toHaveBeenCalledTimes(1);
    });

    it("ticks off one day's occurrence and leaves the series open", async () => {
      const { deps, call } = await connect(connection({ permissions: ['read', 'done'] }));
      const daily = series({});
      deps.tasks.findOne.mockResolvedValue(daily);
      deps.tasks.update.mockResolvedValue({ ...daily, completedDates: [new Date(`${TODAY}T00:00:00Z`)] });

      const result = await call('complete_task', { id: 'r1', date: TODAY });

      expect(result.isError).toBeFalsy();
      expect(deps.tasks.update).toHaveBeenCalledWith('r1', { occurrenceDate: TODAY, occurrenceDone: true }, 'b1');
      expect(deps.prisma.task.update).not.toHaveBeenCalled();
      expect(deps.activity.recordUpdate).toHaveBeenCalled();
      expect(JSON.parse(result.content[0].text)).toMatchObject({ recurring: true, occurrenceDate: TODAY, done: true });
    });

    it("is a no-op for an occurrence that is already done, and refuses a day it isn't scheduled", async () => {
      const { deps, call } = await connect(connection({ permissions: ['read', 'done'] }));
      deps.tasks.findOne.mockResolvedValue(series({ completedDates: [new Date(`${TODAY}T00:00:00Z`)] }));
      const again = await call('complete_task', { id: 'r1', date: TODAY });
      expect(JSON.parse(again.content[0].text).note).toBe('Already ticked off.');
      expect(deps.tasks.update).not.toHaveBeenCalled();

      deps.tasks.findOne.mockResolvedValue(series({ recurrence: 'weekly' }));
      expect((await call('complete_task', { id: 'r1', date: TODAY })).isError).toBe(true);
    });

    it('still keeps agents from editing or deleting a recurring series', async () => {
      const { deps, call } = await connect(connection({ permissions: ['read', 'edit', 'delete'] }));
      deps.tasks.findOne.mockResolvedValue(series({}));
      expect((await call('update_task', { id: 'r1', title: 'x' })).isError).toBe(true);
      expect((await call('delete_task', { id: 'r1' })).isError).toBe(true);
      expect(deps.tasks.remove).not.toHaveBeenCalled();
    });
  });
});
