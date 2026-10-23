import { BoardsService } from './boards.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BoardsService.resolveBoardId', () => {
  it('seeds the default life areas when bootstrapping a new board', async () => {
    const prisma = {
      board: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'b1' }),
      },
      user: { upsert: jest.fn().mockResolvedValue({}) },
      lifeArea: { createMany: jest.fn().mockResolvedValue({ count: 5 }) },
    } as unknown as PrismaService;

    // fetchEmail falls back to a local address when the userinfo call fails.
    await new BoardsService(prisma).resolveBoardId('u1', 'token');

    expect(prisma.lifeArea.createMany).toHaveBeenCalledWith({
      data: [
        { boardId: 'b1', name: 'Home', order: 0 },
        { boardId: 'b1', name: 'Personal', order: 1 },
        { boardId: 'b1', name: 'Work', order: 2 },
        { boardId: 'b1', name: 'Health', order: 3 },
        { boardId: 'b1', name: 'Social', order: 4 },
      ],
    });
  });

  it('does not seed when the board already exists', async () => {
    const prisma = {
      board: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
      lifeArea: { createMany: jest.fn() },
    } as unknown as PrismaService;

    await new BoardsService(prisma).resolveBoardId('u1', 'token');

    expect(prisma.lifeArea.createMany).not.toHaveBeenCalled();
  });
});

describe('BoardsService board access', () => {
  const withMember = (member: unknown) =>
    new BoardsService({ boardMember: { findUnique: jest.fn().mockResolvedValue(member) } } as unknown as PrismaService);

  it('acts on the requested board when the user is a member', async () => {
    await expect(withMember({ role: 'member' }).resolveBoardId('u1', 'token', 'b2')).resolves.toBe('b2');
  });

  it('rejects a board the user does not belong to', async () => {
    await expect(withMember(null).resolveBoardId('u1', 'token', 'b2')).rejects.toThrow('not a member');
  });

  it('only lets the owner invite', async () => {
    const prisma = {
      board: { findUnique: jest.fn().mockResolvedValue({ id: 'b1', ownerId: 'someone-else', shared: true }) },
    } as unknown as PrismaService;
    await expect(new BoardsService(prisma).invite('b1', 'u1', 'a@b.co')).rejects.toThrow('Only the owner');
  });

  it('stores invites lower-cased', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      board: { findUnique: jest.fn().mockResolvedValue({ id: 'b1', ownerId: 'u1', shared: true }) },
      boardMember: { findFirst: jest.fn().mockResolvedValue(null) },
      boardInvite: { upsert },
    } as unknown as PrismaService;
    await new BoardsService(prisma).invite('b1', 'u1', ' Anna@Mail.com ');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { boardId: 'b1', email: 'anna@mail.com', invitedBy: 'u1' } })
    );
  });
});

describe('BoardsService bootstrap race', () => {
  it('creates one board for concurrent first requests', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'b1' });
    const prisma = {
      board: { findFirst: jest.fn().mockResolvedValue(null), create },
      user: { upsert: jest.fn().mockResolvedValue({}) },
      lifeArea: { createMany: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const service = new BoardsService(prisma);

    await Promise.all([1, 2, 3, 4].map(() => service.resolveBoardId('u1', 'token')));

    expect(create).toHaveBeenCalledTimes(1);
  });
});
