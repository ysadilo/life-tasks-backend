import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BoardRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Seeded for every new board; order also picks the display colour (order % 10). */
const DEFAULT_LIFE_AREAS = ['Home', 'Personal', 'Work', 'Health', 'Social'];

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Boards the user belongs to (owned or joined), oldest first. */
  findForUser(userId: string) {
    return this.prisma.board
      .findMany({
        where: { members: { some: { userId } } },
        orderBy: { createdAt: 'asc' },
        include: { members: { include: { user: { select: { email: true } } } } },
      })
      .then((boards) =>
        boards.map(({ members, ...board }) => ({
          ...board,
          role: members.find((m) => m.userId === userId)?.role,
          members: members.map((m) => ({ userId: m.userId, email: m.user.email, role: m.role })),
        }))
      );
  }

  /** Every board created through here is owned by (and its first member is) the creator. */
  async create(ownerId: string, name: string, shared = false, inviteEmails: string[] = []) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Name is required.');

    const board = await this.prisma.board.create({
      data: {
        ownerId,
        name: trimmed,
        shared,
        members: { create: { userId: ownerId, role: BoardRole.owner } },
        lifeAreas: { create: DEFAULT_LIFE_AREAS.map((areaName, order) => ({ name: areaName, order })) },
      },
    });
    if (shared) for (const email of inviteEmails) await this.invite(board.id, ownerId, email);
    return board;
  }

  /** Owner-only; re-inviting a pending or existing member is a no-op. */
  async invite(boardId: string, userId: string, rawEmail: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) throw new NotFoundException(`Board ${boardId} not found`);
    if (board.ownerId !== userId) throw new ForbiddenException('Only the owner can invite people.');
    if (!board.shared) throw new BadRequestException('Personal boards cannot be shared.');

    const email = rawEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException(`"${rawEmail}" is not a valid email.`);

    const member = await this.prisma.boardMember.findFirst({
      where: { boardId, user: { email: { equals: email, mode: 'insensitive' } } },
    });
    if (member) return null;

    return this.prisma.boardInvite.upsert({
      where: { boardId_email: { boardId, email } },
      update: {},
      create: { boardId, email, invitedBy: userId },
    });
  }

  async findInvitesFor(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return [];
    const invites = await this.prisma.boardInvite.findMany({
      where: { email: { equals: user.email, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      include: {
        board: { select: { name: true, _count: { select: { members: true } } } },
        inviter: { select: { email: true } },
      },
    });
    return invites.map((i) => ({
      id: i.id,
      boardId: i.boardId,
      boardName: i.board.name,
      memberCount: i.board._count.members,
      invitedBy: i.inviter.email,
    }));
  }

  /** The invite must be addressed to the caller's email; returns it and the caller's id. */
  private async ownInvite(inviteId: string, userId: string) {
    const [invite, user] = await Promise.all([
      this.prisma.boardInvite.findUnique({ where: { id: inviteId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!invite || !user || invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new NotFoundException(`Invite ${inviteId} not found`);
    }
    return invite;
  }

  async acceptInvite(inviteId: string, userId: string) {
    const invite = await this.ownInvite(inviteId, userId);
    await this.prisma.$transaction([
      this.prisma.boardMember.upsert({
        where: { boardId_userId: { boardId: invite.boardId, userId } },
        update: {},
        create: { boardId: invite.boardId, userId, role: BoardRole.member },
      }),
      this.prisma.boardInvite.delete({ where: { id: inviteId } }),
    ]);
    return { boardId: invite.boardId };
  }

  async declineInvite(inviteId: string, userId: string) {
    await this.ownInvite(inviteId, userId);
    await this.prisma.boardInvite.delete({ where: { id: inviteId } });
  }

  /**
   * The board a request acts on: the one the client names in `X-Board-Id` (the
   * user must be a member), else their oldest board. Bootstraps the User + a
   * personal Board on the first call, so it is safe to call on every route.
   *
   * Concurrent first requests share one in-flight bootstrap per user.
   * ponytail: in-process only; with several API instances, add a DB constraint.
   */
  async resolveBoardId(userId: string, accessToken: string, requestedBoardId?: string): Promise<string> {
    if (requestedBoardId) {
      const member = await this.prisma.boardMember.findUnique({
        where: { boardId_userId: { boardId: requestedBoardId, userId } },
      });
      if (!member) throw new ForbiddenException('You are not a member of this board.');
      return requestedBoardId;
    }

    const pending = this.bootstrapping.get(userId) ?? this.defaultBoardId(userId, accessToken);
    this.bootstrapping.set(userId, pending);
    try {
      return await pending;
    } finally {
      this.bootstrapping.delete(userId);
    }
  }

  private readonly bootstrapping = new Map<string, Promise<string>>();

  private async defaultBoardId(userId: string, accessToken: string): Promise<string> {
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

    const board = await this.prisma.board.create({
      data: { ownerId: userId, name: 'My board', members: { create: { userId, role: BoardRole.owner } } },
    });
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
