import { z } from 'zod';
import { Energy, Priority, Recurrence } from '@prisma/client';

export const MAX_TASKS = 10;
const EFFORTS = [15, 60, 240] as const;

/** What the model is asked for. Free text only — the HTML and ids are built here, never taken from the model. */
const modelTask = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().nullish().catch(null),
  checklist: z.array(z.string()).nullish().catch(null),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .catch(null),
  priority: z.enum(Priority).nullish().catch(null),
  energy: z.enum(Energy).nullish().catch(null),
  effortMinutes: z.number().positive().nullish().catch(null),
  area: z.string().nullish().catch(null),
  recurrence: z.enum(Recurrence).exclude(['custom']).nullish().catch(null),
});
const modelOutput = z.object({ tasks: z.array(modelTask) });

/** A prefill for the New task form; the client creates nothing until the user confirms. */
export interface PhotoDraft {
  title: string;
  /** Rich-text HTML in the shape the editor stores (checklists are `ul[data-checklist]`). */
  description: string | null;
  dueDate: string | null;
  priority: Priority | null;
  energy: Energy | null;
  estimatedMinutes: number | null;
  areaId: string | null;
  recurrence: Recurrence | null;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(notes: string | null | undefined, checklist: string[] | null | undefined): string | null {
  const paragraphs = (notes ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escape(line)}</p>`);
  const items = (checklist ?? []).map((item) => item.trim()).filter(Boolean);
  const list = items.length ? [`<ul data-checklist>${items.map((i) => `<li>${escape(i)}</li>`).join('')}</ul>`] : [];
  const html = [...paragraphs, ...list].join('');
  return html || null;
}

const nearestEffort = (minutes: number) =>
  EFFORTS.reduce((best, e) => (Math.abs(e - minutes) < Math.abs(best - minutes) ? e : best));

/** Validates the model's JSON and maps it onto the task form's vocabulary; anything unusable is dropped, not thrown. */
export function toDrafts(output: unknown, areas: { id: string; name: string }[]): PhotoDraft[] {
  const parsed = modelOutput.safeParse(output);
  if (!parsed.success) return [];
  return parsed.data.tasks.slice(0, MAX_TASKS).map((t) => {
    const area = t.area?.trim().toLowerCase();
    return {
      title: t.title,
      description: toHtml(t.notes, t.checklist),
      dueDate: t.dueDate ?? null,
      priority: t.priority ?? null,
      energy: t.energy ?? null,
      estimatedMinutes: t.effortMinutes ? nearestEffort(t.effortMinutes) : null,
      areaId: (area && areas.find((a) => a.name.toLowerCase() === area)?.id) || null,
      recurrence: t.recurrence ?? null,
    };
  });
}
