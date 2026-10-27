import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FeedbackService } from './feedback.service';

const service = new FeedbackService();
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
  process.env.GITHUB_TOKEN = 'tok';
  process.env.GITHUB_FEEDBACK_REPO = 'me/repo';
});

describe('FeedbackService', () => {
  it('rejects an empty message', async () => {
    await expect(service.create('u1', { message: '  ' })).rejects.toThrow(BadRequestException);
  });

  it('is unavailable without GitHub config', async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(service.create('u1', { message: 'hi' })).rejects.toThrow(ServiceUnavailableException);
  });

  it('opens a labelled issue', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await service.create('u1', { message: 'Love it', page: '/today' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/me/repo/issues');
    expect(JSON.parse(init.body)).toMatchObject({ title: 'Feedback: Love it', labels: ['feedback'] });
  });

  it('surfaces a GitHub failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    await expect(service.create('u1', { message: 'hi' })).rejects.toThrow(ServiceUnavailableException);
  });
});
