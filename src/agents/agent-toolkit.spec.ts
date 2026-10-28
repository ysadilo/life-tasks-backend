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
    },
    tasks: {
      create: jest.fn().mockResolvedValue(task),
      findOne: jest.fn().mockResolvedValue(task),
      remove: jest.fn(),
      findMany: jest.fn().mockResolvedValue([task]),
    },
    activity: { recordAdded: jest.fn() },
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
});
