import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Seeded for every new board; order also picks the display colour (order % 10). */
const DEFAULT_LIFE_AREAS = ['Home', 'Personal', 'Work', 'Health', 'Social'];

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  findByOwner(ownerId: string) {
    return this.prisma.board.findMany({ where: { ownerId } });
  }

  create(ownerId: string, name: string) {
    return this.prisma.board.create({ data: { ownerId, name } });
  }

  /**
   * The solo board for an Auth0 user, bootstrapping the User + Board rows on the
   * first call. Replaces the `boardId` query param the client used to pass.
   *
   * ponytail: two concurrent first requests can create two boards; `orderBy`
   * makes the result stable afterwards. Add `@@unique` on Board.ownerId if
   * single-board-per-user ever needs to be enforced.
   */
  async resolveSoloBoardId(userId: string, accessToken: string): Promise<string> {
    const existing = await this.prisma.board.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.id;

    await this.prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: await this.fetchEmail(userId, accessToken) },
    });

    const board = await this.prisma.board.create({ data: { ownerId: userId, name: 'My board' } });
    await this.prisma.lifeArea.createMany({
      data: DEFAULT_LIFE_AREAS.map((name, order) => ({ boardId: board.id, name, order })),
    });
    return board.id;
  }

  /** Auth0 access tokens don't carry email by default — read it from `/userinfo` once, at bootstrap. */
  private async fetchEmail(userId: string, accessToken: string): Promise<string> {
    const fallback = `${userId}@no-email.local`;
    try {
      const res = await fetch(`https://${process.env.AUTH0_DOMAIN}/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return fallback;
      const info = (await res.json()) as { email?: string };
      return info.email ?? fallback;
    } catch {
      return fallback;
    }
  }
}
