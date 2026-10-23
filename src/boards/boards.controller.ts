import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { CreateBoardDto, InviteDto } from './board.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser } from '../auth/current-user.decorator';

/** Every route bootstraps the caller's User row first, so a brand-new user can list boards or accept an invite. */
@Controller('boards')
@UseGuards(Auth0AuthGuard)
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  async findMine(@CurrentUser() userId: string, @AccessToken() token: string) {
    await this.boards.resolveBoardId(userId, token);
    return this.boards.findForUser(userId);
  }

  @Post()
  async create(@CurrentUser() userId: string, @AccessToken() token: string, @Body() dto: CreateBoardDto) {
    await this.boards.resolveBoardId(userId, token);
    return this.boards.create(userId, dto.name, dto.shared, dto.invites);
  }

  @Get('invites')
  async findInvites(@CurrentUser() userId: string, @AccessToken() token: string) {
    await this.boards.resolveBoardId(userId, token);
    return this.boards.findInvitesFor(userId);
  }

  @Post('invites/:inviteId/accept')
  accept(@CurrentUser() userId: string, @Param('inviteId') inviteId: string) {
    return this.boards.acceptInvite(inviteId, userId);
  }

  @Delete('invites/:inviteId')
  @HttpCode(204)
  async decline(@CurrentUser() userId: string, @Param('inviteId') inviteId: string) {
    await this.boards.declineInvite(inviteId, userId);
  }

  @Post(':id/invites')
  invite(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: InviteDto) {
    return this.boards.invite(id, userId, dto.email);
  }
}
