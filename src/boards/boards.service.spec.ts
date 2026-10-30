import { BoardsService } from './boards.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ImagesService } from '../images/images.service';
import { PrismaService } from '../prisma/prisma.service';

const boardsService = (prisma: PrismaService) =>
  new BoardsService(prisma, { notifyInvited: jest.fn() } as unknown as NotificationsService, new ImagesService());

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
    await boardsService(prisma).resolveBoardId('u1', 'token');

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

    await boardsService(prisma).resolveBoardId('u1', 'token');

    expect(prisma.lifeArea.createMany).not.toHaveBeenCalled();
  });
});

describe('BoardsService board access', () => {
  const withMember = (member: unknown) =>
    boardsService({ boardMember: { findUnique: jest.fn().mockResolvedValue(member) } } as unknown as PrismaService);

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
    await expect(boardsService(prisma).invite('b1', 'u1', 'a@b.co')).rejects.toThrow('Only the owner');
  });

  it('stores invites lower-cased', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      board: { findUnique: jest.fn().mockResolvedValue({ id: 'b1', ownerId: 'u1', shared: true }) },
      boardMember: { findFirst: jest.fn().mockResolvedValue(null) },
      boardInvite: { upsert },
    } as unknown as PrismaService;
    await boardsService(prisma).invite('b1', 'u1', ' Anna@Mail.com ');
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
    const service = boardsService(prisma);

    await Promise.all([1, 2, 3, 4].map(() => service.resolveBoardId('u1', 'token')));

    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('BoardsService management', () => {
  const board = { id: 'b1', ownerId: 'owner' };

  it('only the owner can rename', async () => {
    const prisma = { board: { findUnique: jest.fn().mockResolvedValue(board) } } as unknown as PrismaService;
    await expect(boardsService(prisma).rename('b1', 'someone', 'New')).rejects.toThrow('Only the owner');
  });

  it('refuses to delete the last owned board', async () => {
    const prisma = {
      board: {
        findUnique: jest.fn().mockResolvedValue(board),
        count: jest.fn().mockResolvedValue(1),
        delete: jest.fn(),
      },
    } as unknown as PrismaService;
    await expect(boardsService(prisma).remove('b1', 'owner')).rejects.toThrow('at least one');
    expect(prisma.board.delete).not.toHaveBeenCalled();
  });

  it('the owner cannot leave', async () => {
    const prisma = { board: { findUnique: jest.fn().mockResolvedValue(board) } } as unknown as PrismaService;
    await expect(boardsService(prisma).leave('b1', 'owner')).rejects.toThrow('delete the board');
  });

  it("unassigns a departing member's tasks", async () => {
    const updateMany = jest.fn().mockReturnValue('u');
    const del = jest.fn().mockReturnValue('d');
    const prisma = {
      board: { findUnique: jest.fn().mockResolvedValue(board) },
      boardMember: { findUnique: jest.fn().mockResolvedValue({}), delete: del },
      task: { updateMany },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await boardsService(prisma).leave('b1', 'member');
    expect(updateMany).toHaveBeenCalledWith({
      where: { boardId: 'b1', assigneeId: 'member' },
      data: { assigneeId: null },
    });
    expect(del).toHaveBeenCalled();
  });
});

describe('BoardsService.findForUser counts', () => {
  it('adds today / backlog / for-you counts per board, zero when absent', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([{ boardId: 'b1', _count: 6 }]) // today
      .mockResolvedValueOnce([
        { boardId: 'b1', _count: 3 },
        { boardId: 'b2', _count: 23 },
      ]) // backlog
      .mockResolvedValueOnce([{ boardId: 'b1', _count: 2 }]); // mine
    const prisma = {
      board: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'b1', members: [{ userId: 'u1', role: 'owner', user: { email: 'a@b.co' } }], invites: [] },
          { id: 'b2', members: [{ userId: 'u1', role: 'owner', user: { email: 'a@b.co' } }], invites: [] },
        ]),
      },
      task: { groupBy },
    } as unknown as PrismaService;

    const boards = await boardsService(prisma).findForUser('u1', new Date('2026-10-23'));

    expect(boards.map((b) => b.counts)).toEqual([
      { today: 6, backlog: 3, forYou: 2 },
      { today: 0, backlog: 23, forYou: 0 },
    ]);
  });
});

describe('BoardsService join link', () => {
  it('only the owner can create the link, and only for shared boards', async () => {
    const find = (board: object) =>
      boardsService({ board: { findUnique: jest.fn().mockResolvedValue(board) } } as unknown as PrismaService);
    await expect(find({ id: 'b1', ownerId: 'x', shared: true }).ensureInviteCode('b1', 'u1')).rejects.toThrow(
      'Only the owner'
    );
    await expect(find({ id: 'b1', ownerId: 'u1', shared: false }).ensureInviteCode('b1', 'u1')).rejects.toThrow(
      'Personal'
    );
  });

  it('reuses an existing code and mints one otherwise', async () => {
    const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ inviteCode: data.inviteCode }));
    const prisma = (inviteCode: string | null) =>
      ({
        board: {
          findUnique: jest.fn().mockResolvedValue({ id: 'b1', ownerId: 'u1', shared: true, inviteCode }),
          update,
        },
      }) as unknown as PrismaService;
    await expect(boardsService(prisma('abc')).ensureInviteCode('b1', 'u1')).resolves.toEqual({ code: 'abc' });
    expect(update).not.toHaveBeenCalled();
    const minted = await boardsService(prisma(null)).ensureInviteCode('b1', 'u1');
    expect(minted.code).toMatch(/^[\w-]{20,}$/);
  });

  it('rejects an unknown code', async () => {
    const prisma = { board: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    await expect(boardsService(prisma).previewJoin('nope')).rejects.toThrow('not valid');
  });

  it('joins as a member and uses up a matching email invite', async () => {
    const upsert = jest.fn().mockReturnValue('m');
    const deleteMany = jest.fn().mockReturnValue('d');
    const prisma = {
      board: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'b1', members: [], owner: { email: 'o@x.co' }, _count: { tasks: 0 } }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ email: 'me@x.co' }) },
      boardMember: { upsert },
      boardInvite: { deleteMany },
      $transaction: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await expect(boardsService(prisma).joinByCode('abc', 'u1')).resolves.toEqual({ boardId: 'b1' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { boardId: 'b1', userId: 'u1', role: 'member' } })
    );
    expect(deleteMany).toHaveBeenCalled();
  });
});
