import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImagesService } from '../images/images.service';

@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImagesService
  ) {}

  uploadUrl(userId: string) {
    return this.images.uploadUrl('avatar', userId);
  }

  /** Sets the avatar to an uploaded image, or clears it with null. */
  async set(userId: string, key: string | null) {
    const { avatarKey } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarKey: true },
    });
    return this.images.swap('avatar', userId, key, avatarKey, () =>
      this.prisma.user.update({ where: { id: userId }, data: { avatarKey: key }, select: { avatarKey: true } })
    );
  }
}
