import { LifeAreasService } from './life-areas.service';
import { PrismaService } from '../prisma/prisma.service';

function mockPrisma() {
  return {
    lifeArea: {
      findUnique: jest.fn().mockResolvedValue({ id: 'a1', boardId: 'b1' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    task: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  } as unknown as PrismaService;
}

describe('LifeAreasService.remove', () => {
  it('clears the area from its tasks and deletes it', async () => {
    const prisma = mockPrisma();
    await new LifeAreasService(prisma).remove('a1', 'b1');

    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { areaId: 'a1' },
      data: { areaId: null },
    });
    expect(prisma.lifeArea.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });
});
