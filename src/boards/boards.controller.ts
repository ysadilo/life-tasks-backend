import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { CreateBoardDto, InviteDto, RenameBoardDto } from './board.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser } from '../auth/current-user.decorator';

/** Every route bootstraps the caller's User row first, so a brand-new user can list boards or accept an invite. */
@Controller('boards')
@UseGuards(Auth0AuthGuard)
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  async findMine(@CurrentUser() userId: string, @AccessToken() token: string, @Query('today') today?: string) {
    await this.boards.resolveBoardId(userId, token);
    return this.boards.findForUser(userId, today ? new Date(today) : undefined);
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

  @Get('join/:code')
  preview(@Param('code') code: string) {
    return this.boards.previewJoin(code);
  }

  @Post('join/:code')
  async join(@CurrentUser() userId: string, @AccessToken() token: string, @Param('code') code: string) {
    await this.boards.resolveBoardId(userId, token);
    return this.boards.joinByCode(code, userId);
  }

  @Post(':id/invite-link')
  inviteLink(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.boards.ensureInviteCode(id, userId);
  }

  @Delete(':id/invite-link')
  @HttpCode(204)
  async revokeInviteLink(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.boards.revokeInviteCode(id, userId);
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

  @Patch(':id')
  rename(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: RenameBoardDto) {
    return this.boards.rename(id, userId, dto.name);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.boards.remove(id, userId);
  }

  @Delete(':id/members/me')
  @HttpCode(204)
  async leave(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.boards.leave(id, userId);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  async removeMember(@CurrentUser() userId: string, @Param('id') id: string, @Param('memberId') memberId: string) {
    await this.boards.removeMember(id, userId, memberId);
  }

  @Delete(':id/invites/:inviteId')
  @HttpCode(204)
  async revokeInvite(@CurrentUser() userId: string, @Param('id') id: string, @Param('inviteId') inviteId: string) {
    await this.boards.revokeInvite(id, userId, inviteId);
  }
}
