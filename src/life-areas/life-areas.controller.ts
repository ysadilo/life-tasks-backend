import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { LifeAreasService } from './life-areas.service';
import { BoardsService } from '../boards/boards.service';
import { UpsertLifeAreaDto } from './life-area.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser, RequestedBoardId } from '../auth/current-user.decorator';

@Controller('life-areas')
@UseGuards(Auth0AuthGuard)
export class LifeAreasController {
  constructor(
    private readonly lifeAreas: LifeAreasService,
    private readonly boards: BoardsService
  ) {}

  @Get()
  async findMany(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.lifeAreas.findMany(boardId);
  }

  @Post()
  async create(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @Body() dto: UpsertLifeAreaDto
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.lifeAreas.create(boardId, dto.name);
  }

  @Patch(':id')
  async rename(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpsertLifeAreaDto
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.lifeAreas.rename(id, boardId, dto.name);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @Param('id') id: string
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    await this.lifeAreas.remove(id, boardId);
  }
}
