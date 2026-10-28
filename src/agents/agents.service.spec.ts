import { ForbiddenException } from '@nestjs/common';
import { AgentActionKind } from '@prisma/client';
import { AgentsService, agentDisplayName, groupActivity, type ActivityRow } from './agents.service';

const row = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id,
  connectionId: 'c1',
  agentName: 'Claude',
  kind: AgentActionKind.done,
  taskId: `t-${id}`,
  taskTitle: `Task ${id}`,
  detail: null,
  createdAt: new Date('2026-10-28T09:41:00Z'),
  ...over,
});
const at = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00Z`);

describe('agentDisplayName', () => {
  it.each([
    ['claude-ai', 'Claude'],
    ['cursor', 'Cursor'],
    [undefined, 'Agent'],
    ['   ', 'Agent'],
  ])('%s -> %s', (input, expected) => expect(agentDisplayName(input)).toBe(expected));
});

describe('groupActivity', () => {
  it('collapses a close run of like actions by one agent into one entry', () => {
    const groups = groupActivity([
      row('a', { createdAt: at('09:41') }),
      row('b', { createdAt: at('09:40') }),
      row('c', { createdAt: at('09:39') }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks.map((t) => t.title)).toEqual(['Task a', 'Task b', 'Task c']);
  });

  it('keeps different kinds, agents, distant times and reads apart', () => {
    const groups = groupActivity([
      row('a', { createdAt: at('09:41') }),
      row('b', { kind: AgentActionKind.added, createdAt: at('09:40') }),
      row('c', { kind: AgentActionKind.added, connectionId: 'c2', createdAt: at('09:39') }),
      row('d', { kind: AgentActionKind.added, connectionId: 'c2', createdAt: at('08:00') }),
      row('e', { kind: AgentActionKind.read, taskTitle: null, createdAt: at('07:59') }),
      row('f', { kind: AgentActionKind.read, taskTitle: null, createdAt: at('07:58') }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('AgentsService.connect', () => {
  const prisma = {
    agentConnection: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    board: { findMany: jest.fn() },
    userPreference: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const service = new AgentsService(prisma as never);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.userPreference.findUnique.mockResolvedValue(null); // no row = agents on
  });

  it('creates a first-time agent with read + add on personal boards only', async () => {
    prisma.agentConnection.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.board.findMany.mockResolvedValue([{ id: 'b1' }]);
    prisma.agentConnection.create.mockImplementation(({ data }) => Promise.resolve(data));

    await service.connect('u1', 'client', 'claude-ai');

    expect(prisma.board.findMany).toHaveBeenCalledWith({
      where: { ownerId: 'u1', shared: false },
      select: { id: true },
    });
    expect(prisma.agentConnection.create.mock.calls[0][0].data).toMatchObject({ name: 'Claude', boardIds: ['b1'] });
  });

  it('blocks every agent while the master switch is off', async () => {
    prisma.agentConnection.findUnique.mockResolvedValue({ id: 'c1', revokedAt: null });
    prisma.userPreference.findUnique.mockResolvedValue({ agentsEnabled: false });
    await expect(service.connect('u1', 'client')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a revoked connection and an unknown user', async () => {
    prisma.agentConnection.findUnique.mockResolvedValue({ id: 'c1', revokedAt: new Date() });
    await expect(service.connect('u1', 'client')).rejects.toBeInstanceOf(ForbiddenException);

    prisma.agentConnection.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.connect('u1', 'client')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
