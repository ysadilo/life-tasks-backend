import { Task, TaskStatus } from '@prisma/client';
import { isOccurrenceDone, occursOn } from './recurrence.util';
import type { Language } from '../notifications/notifications.service';

const DAY = 86_400_000;
export const MAX_NOTIFY_DAYS_BEFORE = 30;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type NotifyFields = Pick<Task, 'notifyDaysBefore' | 'notifyTime' | 'notifyTimeZone'>;

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Why the reminder settings are invalid, or null. Off (daysBefore null) needs nothing else. */
export function notifyError({ notifyDaysBefore, notifyTime, notifyTimeZone }: Partial<NotifyFields>): string | null {
  if (notifyDaysBefore == null) return null;
  if (!Number.isInteger(notifyDaysBefore) || notifyDaysBefore < 0 || notifyDaysBefore > MAX_NOTIFY_DAYS_BEFORE) {
    return `notifyDaysBefore must be a whole number from 0 to ${MAX_NOTIFY_DAYS_BEFORE}.`;
  }
  if (!notifyTime || !TIME.test(notifyTime)) return 'notifyTime must be "HH:MM".';
  if (notifyTimeZone && !validTimeZone(notifyTimeZone)) return 'notifyTimeZone is not a known time zone.';
  return null;
}

/** Local calendar day (as UTC midnight) and "HH:MM" of `now` in `timeZone`. */
function localNow(now: Date, timeZone: string): { day: Date; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return {
    day: new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`),
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * The occurrence day a reminder is due for right now, or null. Fires once the
 * local clock passes notifyTime on the reminder day; lastNotifiedFor keeps it to once.
 * ponytail: a reminder day the job never ran on (server down past midnight) is skipped, not caught up.
 */
export function reminderDay(
  task: NotifyFields &
    Pick<
      Task,
      | 'status'
      | 'dueDate'
      | 'lastNotifiedFor'
      | 'recurrence'
      | 'recurrenceInterval'
      | 'recurrenceUnit'
      | 'recurrenceEndDate'
      | 'completedDates'
    >,
  now: Date
): Date | null {
  if (task.notifyDaysBefore == null || !task.notifyTime || !task.dueDate || task.status === TaskStatus.done)
    return null;
  const local = localNow(now, task.notifyTimeZone ?? 'UTC');
  if (local.time < task.notifyTime) return null;
  const day = new Date(local.day.getTime() + task.notifyDaysBefore * DAY);
  const due = task.recurrence
    ? occursOn(task, day) && !isOccurrenceDone(task, day)
    : new Date(task.dueDate).setUTCHours(0, 0, 0, 0) === day.getTime();
  if (!due || task.lastNotifiedFor?.getTime() === day.getTime()) return null;
  return day;
}

const UK_DAYS = { one: 'день', few: 'дні', many: 'днів', other: 'дня' } as Record<string, string>;

export function reminderBody(daysBefore: number, language: Language): string {
  if (language === 'uk') {
    if (daysBefore === 0) return 'Термін сьогодні';
    if (daysBefore === 1) return 'Термін завтра';
    return `Термін через ${daysBefore} ${UK_DAYS[new Intl.PluralRules('uk').select(daysBefore)]}`;
  }
  if (daysBefore === 0) return 'Due today';
  if (daysBefore === 1) return 'Due tomorrow';
  return `Due in ${daysBefore} days`;
}
