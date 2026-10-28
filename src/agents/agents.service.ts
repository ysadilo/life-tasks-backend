import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentActionKind, AgentConnection, AgentPermission, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateAgentDto } from './agent.dto';

const RATE_LIMIT_PER_MINUTE = 120;
const LAST_USED_REFRESH_MS = 60_000;
const GROUP_WINDOW_MS = 5 * 60_000;
const ACTIVITY_LIMIT = 30;
const WEEK_MS = 7 * 24 * 3600_000;

export interface AgentActionInput {
  kind: AgentActionKind;
  boardId?: string;
  taskId?: string;
  taskTitle?: string;
  detail?: string;
}

export interface ActivityRow {
  id: string;
  connectionId: string;
  agentName: string;
  kind: AgentActionKind;
  taskId: string | null;
  taskTitle: string | null;
  detail: string | null;
  createdAt: Date;
}

export interface AgentActivityGroup {
  id: string;
  agentName: string;
  kind: AgentActionKind;
  tasks: { id: string | null; title: string }[];
  /** Only set for a single action; a grouped run has no one detail. */
  detail: string | null;
  createdAt: Date;
}

/** Agents say "Claude", not "claude-ai". */
export function agentDisplayName(clientName?: string): string {
  const cleaned = (clientName ?? '')
    .replace(/[-_]ai$/i, '')
    .trim()
    .slice(0, 40);
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : 'Agent';
}

/**
 * Collapses a newest-first run of like actions by the same agent (done within a
 * few minutes of each other) into one entry, so "marked 3 tasks done" is one row.
 * Reads aren't grouped — each one names what it read.
 */
export function groupActivity(rows: ActivityRow[]): AgentActivityGroup[] {
  const groups: AgentActivityGroup[] = [];
  let last: { connectionId: string; at: number } | undefined;
  for (const row of rows) {
    const prev = groups[groups.length - 1];
    const joins =
      prev &&
      last &&
      row.kind !== AgentActionKind.read &&
      prev.kind === row.kind &&
      last.connectionId === row.connectionId &&
      last.at - row.createdAt.getTime() < GROUP_WINDOW_MS;
    if (joins) {
      prev.tasks.push({ id: row.taskId, title: row.taskTitle ?? '' });
      prev.detail = null;
    } else {
      groups.push({
        id: row.id,
        agentName: row.agentName,
        kind: row.kind,
        tasks: row.taskTitle ? [{ id: row.taskId, title: row.taskTitle }] : [],
        detail: row.detail,
        createdAt: row.createdAt,
      });
    }
    last = { connectionId: row.connectionId, at: row.createdAt.getTime() };
  }
  return groups;
}

@Injectable()
export class AgentsService {
  // ponytail: per-process window; use a shared store if the API ever runs multi-instance.
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The connection for an OAuth client on its first call (safe defaults: read +
   * add, personal boards only) or later ones. `clientName` is only known on the
   * MCP `initialize` handshake.
   */
  async connect(userId: string, clientId: string, clientName?: string): Promise<AgentConnection> {
    const existing = await this.prisma.agentConnection.findUnique({ where: { userId_clientId: { userId, clientId } } });
    if (existing?.revokedAt) throw new ForbiddenException('Access was revoked in Life Tasks › Settings › AI agents.');
    if (!(await this.isEnabled(userId))) {
      throw new ForbiddenException('AI agents are turned off in Life Tasks › Settings › AI agents.');
    }
    if (this.overRateLimit(existing?.id ?? `${userId}:${clientId}`)) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (existing) {
      const stale = !existing.lastUsedAt || Date.now() - existing.lastUsedAt.getTime() > LAST_USED_REFRESH_MS;
      const name = clientName ? agentDisplayName(clientName) : existing.name;
      if (!stale && name === existing.name) return existing;
      return this.prisma.agentConnection.update({ where: { id: existing.id }, data: { lastUsedAt: new Date(), name } });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('Open Life Tasks and sign in once before connecting an agent.');
    const personal = await this.prisma.board.findMany({
      where: { ownerId: userId, shared: false },
      select: { id: true },
    });
    return this.prisma.agentConnection.create({
      data: {
        userId,
        clientId,
        name: agentDisplayName(clientName),
        boardIds: personal.map((b) => b.id),
        lastUsedAt: new Date(),
      },
    });
  }

  /** The master "Allow agents" switch; on unless the user turned it off. */
  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.prisma.userPreference.findUnique({ where: { userId }, select: { agentsEnabled: true } });
    return row?.agentsEnabled ?? true;
  }

  async setEnabled(userId: string, enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new BadRequestException('"enabled" must be true or false.');
    await this.prisma.userPreference.upsert({
      where: { userId },
      update: { agentsEnabled: enabled },
      create: { userId, agentsEnabled: enabled },
    });
    return { enabled };
  }

  private overRateLimit(key: string) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.hits.set(key, recent);
    return recent.length > RATE_LIMIT_PER_MINUTE;
  }

  async findForUser(userId: string) {
    const connections = await this.prisma.agentConnection.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const week = await this.prisma.agentAction.groupBy({
      by: ['connectionId'],
      where: { connection: { userId }, createdAt: { gte: new Date(Date.now() - WEEK_MS) } },
      _count: true,
    });
    return connections.map(({ clientId: _clientId, ...c }) => ({
      ...c,
      actionsThisWeek: week.find((w) => w.connectionId === c.id)?._count ?? 0,
    }));
  }

  async update(userId: string, id: string, dto: UpdateAgentDto) {
    const connection = await this.prisma.agentConnection.findFirst({ where: { id, userId, revokedAt: null } });
    if (!connection) throw new NotFoundException('Agent not found.');

    const data: Prisma.AgentConnectionUpdateInput = {};
    if (dto.permissions !== undefined) {
      const valid = Object.values(AgentPermission) as string[];
      if (!Array.isArray(dto.permissions) || dto.permissions.some((p) => !valid.includes(p))) {
        throw new BadRequestException('Invalid permissions.');
      }
      data.permissions = [...new Set(dto.permissions)];
    }
    if (dto.boardIds !== undefined) {
      if (!Array.isArray(dto.boardIds) || dto.boardIds.some((b) => typeof b !== 'string')) {
        throw new BadRequestException('Invalid boards.');
      }
      const ids = [...new Set(dto.boardIds)];
      const member = await this.prisma.boardMember.count({ where: { userId, boardId: { in: ids } } });
      if (member !== ids.length) throw new ForbiddenException('You are not a member of one of those boards.');
      data.boardIds = ids;
    }
    return this.prisma.agentConnection.update({ where: { id }, data });
  }

  async revoke(userId: string, id: string) {
    const { count } = await this.prisma.agentConnection.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Agent not found.');
  }

  async record(connectionId: string, actions: AgentActionInput[]) {
    if (actions.length === 0) return;
    await this.prisma.agentAction.createMany({ data: actions.map((a) => ({ ...a, connectionId })) });
  }

  async findActivity(userId: string) {
    const rows = await this.prisma.agentAction.findMany({
      where: { connection: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { connection: { select: { name: true } } },
    });
    return groupActivity(
      rows.map((r) => ({
        id: r.id,
        connectionId: r.connectionId,
        agentName: r.connection.name,
        kind: r.kind,
        taskId: r.taskId,
        taskTitle: r.taskTitle,
        detail: r.detail,
        createdAt: r.createdAt,
      }))
    ).slice(0, ACTIVITY_LIMIT);
  }
}
