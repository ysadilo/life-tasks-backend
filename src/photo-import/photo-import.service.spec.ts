import { BadGatewayException } from '@nestjs/common';
import { AI_UNAVAILABLE, PhotoImportService } from './photo-import.service';

const image = { buffer: Buffer.from('x'), mimetype: 'image/jpeg' };
const ok = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"tasks":[{"title":"Milk"}]}' }] } }] }));
const fail = (status: number) => new Response('{"error":{}}', { status });

const service = new PhotoImportService();
const fetchMock = jest.fn();

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'k';
  process.env.GEMINI_MODEL = 'main-model';
  process.env.GEMINI_FALLBACK_MODEL = 'light-model';
  global.fetch = fetchMock;
  fetchMock.mockReset();
  jest.spyOn(service['logger'], 'warn').mockImplementation();
});

const modelsCalled = () => fetchMock.mock.calls.map(([url]) => String(url).match(/models\/([^:]+):/)?.[1]);

describe('PhotoImportService.read', () => {
  it('retries the model once, then falls back to the lighter one', async () => {
    fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok());
    const [draft] = await service.read(image, [], '2026-10-29');
    expect(draft.title).toBe('Milk');
    expect(modelsCalled()).toEqual(['main-model', 'main-model', 'light-model']);
  });

  it('does not retry an error a retry cannot fix', async () => {
    fetchMock.mockImplementation(async () => fail(400));
    await expect(service.read(image, [], '2026-10-29')).rejects.toThrow(BadGatewayException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up with the last status after every model failed', async () => {
    fetchMock.mockImplementation(async () => fail(503));
    await expect(service.read(image, [], '2026-10-29')).rejects.toMatchObject({
      response: { code: AI_UNAVAILABLE, message: 'Photo reading failed (503)' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
