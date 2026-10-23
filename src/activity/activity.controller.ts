import { Controller, Get, UseGuards } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { BoardsService } from '../boards/boards.service';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser, RequestedBoardId } from '../auth/current-user.decorator';

@Controller('activity')
@UseGuards(Auth0AuthGuard)
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly boards: BoardsService
  ) {}

  @Get()
  async findRecent(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.activity.findRecent(boardId);
  }
}
