import { Recurrence, RecurrenceUnit } from '@prisma/client';

// Mirrors the occurrence rule in the FE (src/lib/recurrence.ts). No shared
// package exists between the two repos yet (see CLAUDE.md §2) — this is a
// deliberate, minimal duplication of one small pure function rather than
// standing up package infra for it.

const DAY = 86_400_000;

/** Upper bound on a custom interval, so the missed-occurrence lookback stays bounded. */
export const MAX_CUSTOM_INTERVAL = 365;
const UNIT_DAYS: Record<RecurrenceUnit, number> = { day: 1, week: 7, month: 31 };

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function monthsBetween(start: Date, day: Date): number {
  return (day.getUTCFullYear() - start.getUTCFullYear()) * 12 + day.getUTCMonth() - start.getUTCMonth();
}

function matchesCustom(day: Date, start: Date, interval: number, unit: RecurrenceUnit): boolean {
  switch (unit) {
    case RecurrenceUnit.day:
      return Math.round((day.getTime() - start.getTime()) / DAY) % interval === 0;
    case RecurrenceUnit.week:
      return Math.round((day.getTime() - start.getTime()) / DAY) % (7 * interval) === 0;
    case RecurrenceUnit.month:
      // ponytail: like `monthly`, a series anchored on the 29th–31st skips shorter months.
      return day.getUTCDate() === start.getUTCDate() && monthsBetween(start, day) % interval === 0;
  }
}

/** Why a custom cadence is invalid, or null. Non-custom cadences carry no interval/unit. */
export function customRecurrenceError(
  recurrence: Recurrence | null | undefined,
  interval: number | null | undefined,
  unit: RecurrenceUnit | null | undefined
): string | null {
  if (recurrence !== Recurrence.custom) return null;
  if (!Number.isInteger(interval) || interval! < 1 || interval! > MAX_CUSTOM_INTERVAL || !unit) {
    return `A custom recurrence needs a whole-number interval from 1 to ${MAX_CUSTOM_INTERVAL} and a unit (day, week or month).`;
  }
  return null;
}

function matchesRule(day: Date, start: Date, task: RecurringTaskLike): boolean {
  const r = task.recurrence!;
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
    case Recurrence.custom:
      return matchesCustom(day, start, task.recurrenceInterval ?? 1, task.recurrenceUnit ?? RecurrenceUnit.day);
  }
}

interface RecurringTaskLike {
  recurrence: Recurrence | null;
  recurrenceInterval?: number | null;
  recurrenceUnit?: RecurrenceUnit | null;
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
  return matchesRule(d, start, task);
}

/** Longest gap between occurrences of this series, plus slack — bounds the backward scan. */
function lookbackDays(task: RecurringTaskLike): number {
  if (task.recurrence !== Recurrence.custom) return 35;
  return (task.recurrenceInterval ?? 1) * UNIT_DAYS[task.recurrenceUnit ?? RecurrenceUnit.day] + 4;
}

/** Most recent occurrence day strictly before `today`, or null if none within the lookback window. */
export function previousOccurrenceBefore(task: RecurringTaskLike, today: Date): Date | null {
  if (!task.recurrence || !task.dueDate) return null;
  const start = startOfUTCDay(task.dueDate);
  const todayDay = startOfUTCDay(today);
  const earliest = new Date(Math.max(start.getTime(), todayDay.getTime() - lookbackDays(task) * DAY));
  for (let d = new Date(todayDay.getTime() - DAY); d >= earliest; d = new Date(d.getTime() - DAY)) {
    if (occursOn(task, d)) return d;
  }
  return null;
}
