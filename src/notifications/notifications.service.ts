import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import * as webPush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import type { SubscribeDto } from './notifications.dto';

/** What the service worker shows; `url` is where a click lands, `tag` collapses repeats. */
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  /** Without VAPID keys push is simply off; everything else keeps working. */
  private readonly enabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    this.enabled = !!this.publicKey && !!privateKey;
    if (this.enabled) {
      webPush.setVapidDetails(
        process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost',
        this.publicKey as string,
        privateKey as string
      );
    }
  }

  config() {
    return { publicKey: this.enabled ? this.publicKey : null };
  }

  async subscribe(userId: string, dto: SubscribeDto) {
    if (!dto.endpoint || !dto.keys?.p256dh || !dto.keys?.auth) {
      throw new BadRequestException('A push subscription needs an endpoint and keys.');
    }
    const data = { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth };
    // The same browser can switch accounts, so the endpoint moves to whoever subscribed last.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: data,
      create: { endpoint: dto.endpoint, ...data },
    });
  }

  async mutedBoardIds(userId: string) {
    const rows = await this.prisma.boardMute.findMany({ where: { userId }, select: { boardId: true } });
    return rows.map((row) => row.boardId);
  }

  async setMuted(userId: string, boardId: string, muted: boolean) {
    const member = await this.prisma.boardMember.findUnique({ where: { boardId_userId: { boardId, userId } } });
    if (!member) throw new ForbiddenException('You are not on this board.');
    const where = { boardId_userId: { boardId, userId } };
    if (muted) await this.prisma.boardMute.upsert({ where, update: {}, create: { boardId, userId } });
    else await this.prisma.boardMute.deleteMany({ where: { boardId, userId } });
  }

  /** Everyone on the board except the actor and anyone who muted it; `build` lets each recipient get their own wording. */
  async notifyBoard(boardId: string, actorId: string, build: (recipientId: string) => PushPayload) {
    if (!this.enabled) return;
    const members = await this.prisma.boardMember.findMany({
      where: { boardId, userId: { not: actorId }, user: { boardMutes: { none: { boardId } } } },
      select: { userId: true },
    });
    await Promise.all(members.map((m) => this.send(m.userId, build(m.userId))));
  }

  /** Tells the invitee, if they already have an account; someone who hasn't signed in yet sees the invite on arrival. */
  async notifyInvited(email: string, boardName: string, inviterId: string) {
    if (!this.enabled) return;
    try {
      const [invitee, inviter] = await Promise.all([
        this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }),
        this.prisma.user.findUnique({ where: { id: inviterId }, select: { email: true } }),
      ]);
      if (!invitee) return;
      await this.send(invitee.id, {
        title: 'Added to a board',
        body: `${(inviter?.email ?? 'Someone').split('@')[0]} added you to ${boardName}`,
        tag: `invite:${boardName}`,
        url: '/settings',
      });
    } catch (error) {
      this.logger.error('Could not push an invite', error instanceof Error ? error.stack : String(error));
    }
  }

  /** Best effort: a push failure must never fail the request that caused it. */
  private async send(userId: string, payload: PushPayload) {
    try {
      const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
      await Promise.all(
        subscriptions.map(async ({ id, endpoint, p256dh, auth }) => {
          try {
            await webPush.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload));
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode;
            // 404/410: the browser unsubscribed or the subscription expired.
            if (status === 404 || status === 410) await this.prisma.pushSubscription.delete({ where: { id } });
            else this.logger.warn(`Push to ${endpoint.slice(0, 40)}… failed (${status ?? 'network'})`);
          }
        })
      );
    } catch (error) {
      this.logger.error(`Could not push to user ${userId}`, error instanceof Error ? error.stack : String(error));
    }
  }
}
