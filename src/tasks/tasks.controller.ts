import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { TasksService } from './tasks.service';
import { BoardsService } from '../boards/boards.service';
import { CreateTaskDto, UpdateTaskDto } from './task.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser, RequestedBoardId } from '../auth/current-user.decorator';

@Controller('tasks')
@UseGuards(Auth0AuthGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly boards: BoardsService
  ) {}

  @Get()
  async findMany(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @Query('status') status?: TaskStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('recurring') recurring?: string,
    @Query('today') today?: string
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.tasks.findMany({
      boardId,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      recurring: recurring === 'true',
      today: today ? new Date(today) : undefined,
    });
  }

  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @Param('id') id: string
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.tasks.findOne(id, boardId);
  }

  @Post()
  async create(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @Body() dto: CreateTaskDto,
    @Query('today') today?: string
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.tasks.create(boardId, dto, today ? new Date(today) : undefined);
  }

  @Patch(':id')
  async update(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @Query('today') today?: string
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.tasks.update(id, dto, boardId, today ? new Date(today) : undefined);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @Param('id') id: string
  ) {
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    return this.tasks.remove(id, boardId);
  }
}
