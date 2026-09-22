import { Recurrence } from '@prisma/client';

// Mirrors the occurrence rule in the FE (src/lib/recurrence.ts). No shared
// package exists between the two repos yet (see CLAUDE.md §2) — this is a
// deliberate, minimal duplication of one small pure function rather than
// standing up package infra for it.

const DAY = 86_400_000;

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function matchesRule(day: Date, start: Date, r: Recurrence): boolean {
  const diffDays = Math.round((day.getTime() - start.getTime()) / DAY);
  switch (r) {
    case Recurrence.daily:
      return true;
    case Recurrence.weekdays:
      return day.getUTCDay() >= 1 && day.getUTCDay() <= 5;
    case Recurrence.weekly:
      return diffDays % 7 === 0;
    case Recurrence.biweekly:
      return diffDays % 14 === 0;
    case Recurrence.monthly:
      return day.getUTCDate() === start.getUTCDate();
  }
}

interface RecurringTaskLike {
  recurrence: Recurrence | null;
  dueDate: Date | null;
  recurrenceEndDate: Date | null;
}

/** `day` is a UTC-midnight date. */
export function occursOn(task: RecurringTaskLike, day: Date): boolean {
  if (!task.recurrence || !task.dueDate) return false;
  const start = startOfUTCDay(task.dueDate);
  const d = startOfUTCDay(day);
  if (d < start) return false;
  if (task.recurrenceEndDate && d > startOfUTCDay(task.recurrenceEndDate)) return false;
  return matchesRule(d, start, task.recurrence);
}

/** Longest gap between occurrences across all rules, plus slack — bounds the backward scan. */
const MAX_LOOKBACK_DAYS = 35;

/** Most recent occurrence day strictly before `today`, or null if none within the lookback window. */
export function previousOccurrenceBefore(task: RecurringTaskLike, today: Date): Date | null {
  if (!task.recurrence || !task.dueDate) return null;
  const start = startOfUTCDay(task.dueDate);
  const todayDay = startOfUTCDay(today);
  const earliest = new Date(Math.max(start.getTime(), todayDay.getTime() - MAX_LOOKBACK_DAYS * DAY));
  for (let d = new Date(todayDay.getTime() - DAY); d >= earliest; d = new Date(d.getTime() - DAY)) {
    if (occursOn(task, d)) return d;
  }
  return null;
}
