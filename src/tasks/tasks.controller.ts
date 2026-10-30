import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { TasksService } from './tasks.service';
import { BoardsService } from '../boards/boards.service';
import { ActivityService } from '../activity/activity.service';
import { CreateTaskDto, UpdateTaskDto } from './task.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser, RequestedBoardId } from '../auth/current-user.decorator';

@Controller('tasks')
@UseGuards(Auth0AuthGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly boards: BoardsService,
    private readonly activity: ActivityService
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
    const task = await this.tasks.create(boardId, dto, today ? new Date(today) : undefined);
    await this.activity.recordAdded(boardId, userId, task);
    return task;
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
    const before = await this.tasks.findOne(id, boardId);
    // Completing, reopening or reflecting on a task is the assignee's call (unassigned tasks are open to all).
    const touchesCompletion =
      dto.status === TaskStatus.done ||
      (before.status === TaskStatus.done &&
        (dto.status !== undefined || dto.feeling !== undefined || dto.actualMinutes !== undefined));
    if (touchesCompletion && before.assigneeId && before.assigneeId !== userId) {
      throw new ForbiddenException('Only the assignee can do this.');
    }
    // Whoever completes an unassigned task takes it.
    if (dto.status === TaskStatus.done && !before.assigneeId && dto.assigneeId === undefined) dto.assigneeId = userId;
    const after = await this.tasks.update(id, dto, boardId, today ? new Date(today) : undefined);
    await this.activity.recordUpdate(boardId, userId, before, after, dto);
    return after;
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
