import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PhotoDraft, toDrafts } from './photo-import.mapper';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** `code` of the 502 body when the AI provider failed (as opposed to our own errors), so the client can say so. */
export const AI_UNAVAILABLE = 'ai_unavailable';
const aiUnavailable = (message: string) =>
  new BadGatewayException({ statusCode: 502, error: 'Bad Gateway', code: AI_UNAVAILABLE, message });
const RETRYABLE = new Set([429, 500, 503, 504]);
const RETRY_DELAY_MS = 800;
const TIMEOUT_MS = 15_000;

const PROMPT = (
  areas: string[],
  today: string,
  hint?: string
) => `You read a photo and turn it into tasks for a personal to-do app.
- A list (shopping, packing, to-dos): ONE task with a short title and the lines in "checklist".
- A letter, notice or document: ONE task whose "notes" summarise what must be done, with the key reference numbers, fees and the deadline as "dueDate".
- A whiteboard or several separate jobs: one task per job, at most 10.
Only fill priority, energy, effortMinutes, recurrence or area when the photo makes them clear; otherwise leave them null.
Today is ${today}; resolve dates like "15 November" to the next such date as YYYY-MM-DD.
"area" must be exactly one of: ${areas.join(', ') || '(none)'} — or null.
Keep the language of the photo. Return an empty list if nothing readable is there.${hint ? `\nThe user adds: ${hint}` : ''}`;

const nullable = (type: string, extra = {}) => ({ type, nullable: true, ...extra });
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          notes: nullable('STRING'),
          checklist: nullable('ARRAY', { items: { type: 'STRING' } }),
          dueDate: nullable('STRING'),
          priority: nullable('STRING', { enum: ['P1', 'P2', 'P3', 'P4'] }),
          energy: nullable('STRING', { enum: ['low', 'medium', 'high'] }),
          effortMinutes: nullable('INTEGER'),
          area: nullable('STRING'),
          recurrence: nullable('STRING', { enum: ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'] }),
        },
        required: ['title'],
      },
    },
  },
  required: ['tasks'],
};

const STUB: PhotoDraft = {
  title: 'Groceries for the week',
  description: '<ul data-checklist><li>Oat milk ×2</li><li>Eggs (12)</li><li>Sourdough</li></ul>',
  dueDate: null,
  priority: null,
  energy: null,
  estimatedMinutes: 60,
  areaId: null,
  recurrence: null,
};

@Injectable()
export class PhotoImportService {
  private readonly logger = new Logger(PhotoImportService.name);

  /**
   * Reads one photo and returns drafts; creates nothing and stores nothing (the image only lives in this request).
   * Set PHOTO_IMPORT_STUB=1 to get a canned result without calling Gemini.
   */
  async read(
    image: { buffer: Buffer; mimetype: string },
    areas: { id: string; name: string }[],
    today: string,
    hint?: string
  ): Promise<PhotoDraft[]> {
    if (process.env.PHOTO_IMPORT_STUB === '1') return [STUB];
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new ServiceUnavailableException('Photo import is not configured');

    const primary = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const fallback = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
    const res = await this.generate(
      [primary, primary, fallback],
      key,
      JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: PROMPT(
                  areas.map((a) => a.name),
                  today,
                  hint?.slice(0, 300)
                ),
              },
              { inline_data: { mime_type: image.mimetype, data: image.buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: 'minimal' },
        },
      })
    );

    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    try {
      return toDrafts(text ? JSON.parse(text) : null, areas);
    } catch {
      throw aiUnavailable('Photo reading returned unreadable output');
    }
  }

  /**
   * Gemini's free tier is often "high demand" (503) or rate limited (429): try each model in turn
   * (the same one twice, then a lighter one) and give up at the first error a retry can't fix.
   */
  private async generate(models: string[], key: string, body: string): Promise<Response> {
    let last: number | string = 'no response';
    for (const [i, model] of models.entries()) {
      if (i > 0 && model === models[i - 1]) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      try {
        const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return res;
        last = res.status;
        this.logger.warn(`Gemini ${model} answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
        if (!RETRYABLE.has(res.status)) break;
      } catch (error) {
        last = 'no response';
        this.logger.warn(`Gemini ${model} failed: ${(error as Error).message}`);
      }
    }
    throw aiUnavailable(`Photo reading failed (${last})`);
  }
}
