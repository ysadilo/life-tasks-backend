import { BoardsService } from './boards.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BoardsService.resolveSoloBoardId', () => {
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
    await new BoardsService(prisma).resolveSoloBoardId('u1', 'token');

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

    await new BoardsService(prisma).resolveSoloBoardId('u1', 'token');

    expect(prisma.lifeArea.createMany).not.toHaveBeenCalled();
  });
});
