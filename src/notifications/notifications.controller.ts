import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { MuteDto, SubscribeDto } from './notifications.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('notifications')
@UseGuards(Auth0AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** The VAPID public key the browser subscribes with; null when push isn't configured. */
  @Get('config')
  config() {
    return this.notifications.config();
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(@CurrentUser() userId: string, @Body() dto: SubscribeDto) {
    await this.notifications.subscribe(userId, dto);
  }

  @Get('mutes')
  mutes(@CurrentUser() userId: string) {
    return this.notifications.mutedBoardIds(userId);
  }

  @Put('mutes/:boardId')
  @HttpCode(204)
  async setMuted(@CurrentUser() userId: string, @Param('boardId') boardId: string, @Body() dto: MuteDto) {
    await this.notifications.setMuted(userId, boardId, !!dto.muted);
  }
}
