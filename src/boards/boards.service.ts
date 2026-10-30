import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BoardRole, TaskStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ImagesService } from '../images/images.service';

/** Seeded for every new board; order also picks the display colour (order % 10). */
const DEFAULT_LIFE_AREAS = ['Home', 'Personal', 'Work', 'Health', 'Social'];

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly images: ImagesService
  ) {}

  /**
   * Boards the user belongs to (owned or joined), oldest first, each with its
   * open-work counts for the caller's local `today` (one-off tasks only —
   * recurring occurrences are virtual): tasks on Today, in the backlog, and
   * on Today assigned to the caller.
   */
  async findForUser(userId: string, today?: Date) {
    const boards = await this.findMemberBoards(userId);
    const ids = boards.map((b) => b.id);
    const day = today ? new Date(today) : undefined;
    day?.setUTCHours(0, 0, 0, 0);
    // A Today task from an earlier day is about to roll into Triage, so it doesn't count.
    const todayWhere = {
      boardId: { in: ids },
      recurrence: null,
      status: TaskStatus.today,
      ...(day ? { todayDate: { gte: day } } : {}),
    };

    const [todayCounts, backlogCounts, mineCounts] = await Promise.all([
      this.prisma.task.groupBy({ by: ['boardId'], where: todayWhere, _count: true }),
      this.prisma.task.groupBy({
        by: ['boardId'],
        where: { boardId: { in: ids }, recurrence: null, status: TaskStatus.backlog },
        _count: true,
      }),
      this.prisma.task.groupBy({ by: ['boardId'], where: { ...todayWhere, assigneeId: userId }, _count: true }),
    ]);
    const countOf = (rows: { boardId: string; _count: number }[], id: string) =>
      rows.find((r) => r.boardId === id)?._count ?? 0;

    return boards.map((board) => ({
      ...board,
      counts: {
        today: countOf(todayCounts, board.id),
        backlog: countOf(backlogCounts, board.id),
        forYou: countOf(mineCounts, board.id),
      },
    }));
  }

  private findMemberBoards(userId: string) {
    return this.prisma.board
      .findMany({
        where: { members: { some: { userId } } },
        orderBy: { createdAt: 'asc' },
        include: {
          members: { include: { user: { select: { email: true, avatarKey: true } } } },
          invites: { select: { id: true, email: true }, orderBy: { createdAt: 'asc' } },
        },
      })
      .then((boards) =>
        boards.map(({ members, invites, ...board }) => {
          const role = members.find((m) => m.userId === userId)?.role;
          return {
            ...board,
            role,
            // Pending invites are the owner's business only.
            invites: role === BoardRole.owner ? invites : [],
            inviteCode: role === BoardRole.owner ? board.inviteCode : null,
            members: members.map((m) => ({
              userId: m.userId,
              email: m.user.email,
              avatarKey: m.user.avatarKey,
              role: m.role,
              isMe: m.userId === userId,
            })),
          };
        })
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

  private async ownedBoard(boardId: string, userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) throw new NotFoundException(`Board ${boardId} not found`);
    if (board.ownerId !== userId) throw new ForbiddenException('Only the owner can do that.');
    return board;
  }

  async rename(boardId: string, userId: string, rawName: string) {
    await this.ownedBoard(boardId, userId);
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Name is required.');
    return this.prisma.board.update({ where: { id: boardId }, data: { name } });
  }

  async coverUploadUrl(boardId: string, userId: string) {
    await this.ownedBoard(boardId, userId);
    return this.images.uploadUrl('cover', boardId);
  }

  /** Sets the board's cover to an uploaded image, or clears it with null. Owner only. */
  async setCover(boardId: string, userId: string, key: string | null) {
    const { coverKey } = await this.ownedBoard(boardId, userId);
    return this.images.swap('cover', boardId, key, coverKey, () =>
      this.prisma.board.update({ where: { id: boardId }, data: { coverKey: key }, select: { coverKey: true } })
    );
  }

  /** Deletes the board for everyone (tasks, life areas, members and invites cascade). Users keep at least one board. */
  async remove(boardId: string, userId: string) {
    await this.ownedBoard(boardId, userId);
    const owned = await this.prisma.board.count({ where: { ownerId: userId } });
    if (owned <= 1) throw new BadRequestException('You need to keep at least one board of your own.');
    await this.prisma.board.delete({ where: { id: boardId } });
  }

  /** A member leaves; the owner can't (delete the board instead). Their assigned tasks become unassigned. */
  async leave(boardId: string, userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId } });
    if (!board) throw new NotFoundException(`Board ${boardId} not found`);
    if (board.ownerId === userId) throw new BadRequestException("The owner can't leave; delete the board instead.");
    await this.dropMember(boardId, userId);
  }

  async removeMember(boardId: string, ownerId: string, memberId: string) {
    await this.ownedBoard(boardId, ownerId);
    if (memberId === ownerId) throw new BadRequestException("The owner can't be removed.");
    await this.dropMember(boardId, memberId);
  }

  private async dropMember(boardId: string, userId: string) {
    const member = await this.prisma.boardMember.findUnique({ where: { boardId_userId: { boardId, userId } } });
    if (!member) throw new NotFoundException('Not a member of this board.');
    await this.prisma.$transaction([
      this.prisma.task.updateMany({ where: { boardId, assigneeId: userId }, data: { assigneeId: null } }),
      this.prisma.boardMember.delete({ where: { boardId_userId: { boardId, userId } } }),
    ]);
  }

  async revokeInvite(boardId: string, ownerId: string, inviteId: string) {
    await this.ownedBoard(boardId, ownerId);
    const { count } = await this.prisma.boardInvite.deleteMany({ where: { id: inviteId, boardId } });
    if (!count) throw new NotFoundException(`Invite ${inviteId} not found`);
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

    const invite = await this.prisma.boardInvite.upsert({
      where: { boardId_email: { boardId, email } },
      update: {},
      create: { boardId, email, invitedBy: userId },
    });
    await this.notifications.notifyInvited(email, board.name, userId);
    return invite;
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

  /** Owner: the board's join link code, created on first use. Only shared boards have one. */
  async ensureInviteCode(boardId: string, userId: string) {
    const board = await this.ownedBoard(boardId, userId);
    if (!board.shared) throw new BadRequestException('Personal boards cannot be shared.');
    if (board.inviteCode) return { code: board.inviteCode };
    const updated = await this.prisma.board.update({
      where: { id: boardId },
      data: { inviteCode: randomBytes(16).toString('base64url') },
    });
    return { code: updated.inviteCode };
  }

  /** Disables the link; the next `ensureInviteCode` mints a fresh one, so this doubles as "reset". */
  async revokeInviteCode(boardId: string, userId: string) {
    await this.ownedBoard(boardId, userId);
    await this.prisma.board.update({ where: { id: boardId }, data: { inviteCode: null } });
  }

  private async boardByCode(code: string) {
    const board = await this.prisma.board.findUnique({
      where: { inviteCode: code },
      include: {
        members: { include: { user: { select: { email: true } } } },
        owner: { select: { email: true } },
        _count: { select: { tasks: true } },
      },
    });
    if (!board) throw new NotFoundException('This invite link is not valid.');
    return board;
  }

  /** What the join page shows: whose board it is and who is already there. */
  async previewJoin(code: string) {
    const board = await this.boardByCode(code);
    return {
      boardId: board.id,
      boardName: board.name,
      invitedBy: board.owner.email,
      members: board.members.map((m) => m.user.email),
      taskCount: board._count.tasks,
    };
  }

  /** Anyone signed in with the code joins as a member (joining twice is a no-op); a matching email invite is used up. */
  async joinByCode(code: string, userId: string) {
    const board = await this.boardByCode(code);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    await this.prisma.$transaction([
      this.prisma.boardMember.upsert({
        where: { boardId_userId: { boardId: board.id, userId } },
        update: {},
        create: { boardId: board.id, userId, role: BoardRole.member },
      }),
      ...(user
        ? [
            this.prisma.boardInvite.deleteMany({
              where: { boardId: board.id, email: { equals: user.email, mode: 'insensitive' as const } },
            }),
          ]
        : []),
    ]);
    return { boardId: board.id };
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
