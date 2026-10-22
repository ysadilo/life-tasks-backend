import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { PreferencesService } from './preferences.service';
import { UpdatePreferencesDto } from './preferences.dto';
import { BoardsService } from '../boards/boards.service';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { AccessToken, CurrentUser } from '../auth/current-user.decorator';

@Controller('preferences')
@UseGuards(Auth0AuthGuard)
export class PreferencesController {
  constructor(
    private readonly preferences: PreferencesService,
    private readonly boards: BoardsService
  ) {}

  @Get()
  get(@CurrentUser() userId: string) {
    return this.preferences.get(userId);
  }

  @Patch()
  async update(@CurrentUser() userId: string, @AccessToken() token: string, @Body() dto: UpdatePreferencesDto) {
    // Resolving the solo board bootstraps the User row the preference row points at.
    await this.boards.resolveSoloBoardId(userId, token);
    return this.preferences.update(userId, dto);
  }
}
