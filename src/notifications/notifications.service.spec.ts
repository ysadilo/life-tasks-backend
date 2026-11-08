import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  it('does nothing without VAPID keys', async () => {
    // A local .env may carry keys (Prisma loads it).
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const findMany = jest.fn();
    const prisma = {
      boardMember: { findMany },
      userPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new NotificationsService(prisma);
    await service.notifyBoard('b1', 'u1', () => ({ title: 't', body: 'b', tag: 't', url: '/' }));
    expect(findMany).not.toHaveBeenCalled();
    // Off until the user turns it on.
    expect(await service.config('u1')).toEqual({ publicKey: null, enabled: false });
  });

  it('rejects a non-boolean master switch', async () => {
    await expect(new NotificationsService({} as PrismaService).setEnabled('u1', 'yes' as never)).rejects.toThrow(
      'true or false'
    );
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
