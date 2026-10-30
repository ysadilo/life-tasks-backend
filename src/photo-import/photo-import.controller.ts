import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PhotoImportService } from './photo-import.service';
import { BoardsService } from '../boards/boards.service';
import { LifeAreasService } from '../life-areas/life-areas.service';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser, RequestedBoardId } from '../auth/current-user.decorator';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Controller('tasks/from-photo')
@UseGuards(Auth0AuthGuard)
export class PhotoImportController {
  constructor(
    private readonly photoImport: PhotoImportService,
    private readonly boards: BoardsService,
    private readonly lifeAreas: LifeAreasService
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_BYTES } }))
  async fromPhoto(
    @CurrentUser() userId: string,
    @AccessToken() token: string,
    @RequestedBoardId() requestedBoard: string | undefined,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Body('hint') hint?: string,
    @Query('today') today?: string
  ) {
    if (!photo || !TYPES.includes(photo.mimetype)) throw new BadRequestException('Send a JPEG, PNG or WebP photo');
    const boardId = await this.boards.resolveBoardId(userId, token, requestedBoard);
    const areas = await this.lifeAreas.findMany(boardId);
    return { tasks: await this.photoImport.read(photo, areas, today ?? new Date().toISOString().slice(0, 10), hint) };
  }
}
