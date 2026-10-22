import { BadRequestException } from '@nestjs/common';
import { TaskGroupBy, TaskSort } from '@prisma/client';
import { PreferencesService } from './preferences.service';
import { PrismaService } from '../prisma/prisma.service';

const prisma = {
  userPreference: {
    findUnique: jest.fn(),
    upsert: jest.fn((args) => ({ todaySortBy: 'priority', backlogGroupBy: 'area', ...args.update })),
  },
} as unknown as PrismaService;
const service = new PreferencesService(prisma);

beforeEach(() => jest.clearAllMocks());

describe('PreferencesService', () => {
  it('returns defaults when the user has no row', async () => {
    (prisma.userPreference.findUnique as jest.Mock).mockResolvedValue(null);
    expect(await service.get('u1')).toEqual({ todaySortBy: TaskSort.priority, backlogGroupBy: TaskGroupBy.area });
  });

  it('only changes the fields that were sent', async () => {
    await service.update('u1', { backlogGroupBy: TaskGroupBy.energy });
    expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { backlogGroupBy: TaskGroupBy.energy } })
    );
  });

  it('rejects unknown values', async () => {
    await expect(service.update('u1', { todaySortBy: 'bogus' as TaskSort })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
