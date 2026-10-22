import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TaskGroupBy, TaskSort } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePreferencesDto } from './preferences.dto';

const DEFAULTS = { todaySortBy: TaskSort.priority, backlogGroupBy: TaskGroupBy.area };

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const row = await this.prisma.userPreference.findUnique({ where: { userId } });
    return {
      todaySortBy: row?.todaySortBy ?? DEFAULTS.todaySortBy,
      backlogGroupBy: row?.backlogGroupBy ?? DEFAULTS.backlogGroupBy,
    };
  }

  /** Partial update; only the fields sent change. The user row must already exist (see BoardsService). */
  async update(userId: string, dto: UpdatePreferencesDto) {
    if (dto.todaySortBy !== undefined && !(dto.todaySortBy in TaskSort)) {
      throw new BadRequestException(`Unknown todaySortBy "${dto.todaySortBy}".`);
    }
    if (dto.backlogGroupBy !== undefined && !(dto.backlogGroupBy in TaskGroupBy)) {
      throw new BadRequestException(`Unknown backlogGroupBy "${dto.backlogGroupBy}".`);
    }
    const data: Prisma.UserPreferenceUncheckedUpdateInput = {
      ...(dto.todaySortBy !== undefined && { todaySortBy: dto.todaySortBy }),
      ...(dto.backlogGroupBy !== undefined && { backlogGroupBy: dto.backlogGroupBy }),
    };
    const row = await this.prisma.userPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data } as Prisma.UserPreferenceUncheckedCreateInput,
    });
    return { todaySortBy: row.todaySortBy, backlogGroupBy: row.backlogGroupBy };
  }
}
