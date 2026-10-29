import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  it('does nothing without VAPID keys', async () => {
    const findMany = jest.fn();
    const prisma = { boardMember: { findMany } } as unknown as PrismaService;
    const service = new NotificationsService(prisma);
    await service.notifyBoard('b1', 'u1', () => ({ title: 't', body: 'b', tag: 't', url: '/' }));
    expect(findMany).not.toHaveBeenCalled();
    expect(service.config()).toEqual({ publicKey: null });
  });

  it('only lets board members mute the board', async () => {
    const prisma = { boardMember: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    await expect(new NotificationsService(prisma).setMuted('u1', 'b1', true)).rejects.toThrow('not on this board');
  });

  it('rejects a subscription without keys', async () => {
    await expect(
      new NotificationsService({} as PrismaService).subscribe('u1', { endpoint: 'https://x', keys: undefined as never })
    ).rejects.toThrow('needs an endpoint');
  });
});
