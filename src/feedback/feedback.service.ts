import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CreateFeedbackDto } from './feedback.dto';

const MAX_MESSAGE = 2000;
const MAX_PAGE = 200;
const TITLE_LENGTH = 70;

@Injectable()
export class FeedbackService {
  /** Files the feedback as a GitHub issue. The token stays here, never in the client. */
  async create(userId: string, dto: CreateFeedbackDto): Promise<void> {
    const message = dto.message?.trim();
    if (!message || message.length > MAX_MESSAGE) {
      throw new BadRequestException(`message is required and at most ${MAX_MESSAGE} characters`);
    }
    const page = (dto.page ?? '').slice(0, MAX_PAGE);

    const { GITHUB_TOKEN: token, GITHUB_FEEDBACK_REPO: repo } = process.env;
    if (!token || !repo) throw new ServiceUnavailableException('Feedback is not configured');

    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'life-tasks-backend',
      },
      body: JSON.stringify({
        title: `Feedback: ${message.replace(/\s+/g, ' ').slice(0, TITLE_LENGTH)}`,
        body: `${message}\n\n---\nPage: \`${page}\`\nUser: \`${userId}\``,
        labels: ['feedback'],
      }),
    });
    if (!res.ok) throw new ServiceUnavailableException(`GitHub rejected the feedback (${res.status})`);
  }
}
