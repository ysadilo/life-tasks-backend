import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_LIFE_AREAS = 10;

@Injectable()
export class LifeAreasService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(boardId: string) {
    const areas = await this.prisma.lifeArea.findMany({
      where: { boardId },
      orderBy: { order: 'asc' },
      include: { _count: { select: { tasks: true } } },
    });
    return areas.map(({ _count, ...area }) => ({ ...area, taskCount: _count.tasks }));
  }

  private async findOneOrThrow(id: string, boardId: string) {
    const area = await this.prisma.lifeArea.findUnique({ where: { id } });
    if (!area || area.boardId !== boardId) throw new NotFoundException(`Life area ${id} not found`);
    return area;
  }

  private async assertNameFree(boardId: string, name: string, excludeId?: string) {
    const clash = await this.prisma.lifeArea.findFirst({
      where: { boardId, name: { equals: name, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (clash) throw new ConflictException(`A life area named "${name}" already exists.`);
  }

  async create(boardId: string, rawName: string) {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Name is required.');

    const count = await this.prisma.lifeArea.count({ where: { boardId } });
    if (count >= MAX_LIFE_AREAS) throw new BadRequestException(`You can only have up to ${MAX_LIFE_AREAS} life areas.`);
    await this.assertNameFree(boardId, name);

    const last = await this.prisma.lifeArea.findFirst({ where: { boardId }, orderBy: { order: 'desc' } });
    return this.prisma.lifeArea.create({ data: { boardId, name, order: (last?.order ?? -1) + 1 } });
  }

  async rename(id: string, boardId: string, rawName: string) {
    await this.findOneOrThrow(id, boardId);
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Name is required.');
    await this.assertNameFree(boardId, name, id);
    return this.prisma.lifeArea.update({ where: { id }, data: { name } });
  }

  /** Clears the area from its tasks (they keep no life area) before deleting it. */
  async remove(id: string, boardId: string) {
    await this.findOneOrThrow(id, boardId);
    await this.prisma.task.updateMany({ where: { areaId: id }, data: { areaId: null } });
    await this.prisma.lifeArea.delete({ where: { id } });
  }
}
