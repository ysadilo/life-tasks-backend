import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PhotoDraft, toDrafts } from './photo-import.mapper';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

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

    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
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
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) throw new BadGatewayException(`Photo reading failed (${res.status})`);

    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    try {
      return toDrafts(text ? JSON.parse(text) : null, areas);
    } catch {
      throw new BadGatewayException('Photo reading returned unreadable output');
    }
  }
}
