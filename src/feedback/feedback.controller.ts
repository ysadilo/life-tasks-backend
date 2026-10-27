import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './feedback.dto';
import { Auth0AuthGuard } from '../auth/auth0-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('feedback')
@UseGuards(Auth0AuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(204)
  create(@CurrentUser() userId: string, @Body() dto: CreateFeedbackDto) {
    return this.feedback.create(userId, dto);
  }
}
