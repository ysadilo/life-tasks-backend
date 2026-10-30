import { Body, Controller, Delete, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { AvatarService } from './avatar.service';
import { ImageKeyDto } from '../images/image.dto';
import { BoardsService } from '../boards/boards.service';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser } from '../auth/current-user.decorator';

/** Every route bootstraps the caller's User row first, which the avatar is stored on. */
@Controller('me/avatar')
@UseGuards(Auth0AuthGuard)
export class AvatarController {
  constructor(
    private readonly avatar: AvatarService,
    private readonly boards: BoardsService
  ) {}

  @Post('upload-url')
  async uploadUrl(@CurrentUser() userId: string, @AccessToken() token: string) {
    await this.boards.resolveBoardId(userId, token);
    return this.avatar.uploadUrl(userId);
  }

  @Put()
  async set(@CurrentUser() userId: string, @AccessToken() token: string, @Body() dto: ImageKeyDto) {
    await this.boards.resolveBoardId(userId, token);
    return this.avatar.set(userId, dto.key);
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentUser() userId: string, @AccessToken() token: string) {
    await this.boards.resolveBoardId(userId, token);
    await this.avatar.set(userId, null);
  }
}
