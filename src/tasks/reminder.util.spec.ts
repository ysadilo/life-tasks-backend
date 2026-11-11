import { Recurrence, Task, TaskStatus } from '@prisma/client';
import { notifyError, reminderBody, reminderDay } from './reminder.util';

const task = (over: Partial<Task>) =>
  ({
    status: TaskStatus.backlog,
    dueDate: new Date('2026-11-10T00:00:00Z'),
    notifyDaysBefore: 1,
    notifyTime: '09:00',
    notifyTimeZone: 'Europe/Kyiv', // UTC+2 in November
    lastNotifiedFor: null,
    recurrence: null,
    recurrenceInterval: null,
    recurrenceUnit: null,
    recurrenceEndDate: null,
    completedDates: [],
    ...over,
  }) as Task;

describe('reminderDay', () => {
  it('fires once local time passes notifyTime on the reminder day', () => {
    expect(reminderDay(task({}), new Date('2026-11-09T06:59:00Z'))).toBeNull(); // 08:59 Kyiv
    expect(reminderDay(task({}), new Date('2026-11-09T07:00:00Z'))).toEqual(new Date('2026-11-10T00:00:00Z'));
  });

  it('does not fire twice for the same occurrence, off, or when done', () => {
    const now = new Date('2026-11-09T08:00:00Z');
    expect(reminderDay(task({ lastNotifiedFor: new Date('2026-11-10T00:00:00Z') }), now)).toBeNull();
    expect(reminderDay(task({ notifyDaysBefore: null }), now)).toBeNull();
    expect(reminderDay(task({ status: TaskStatus.done }), now)).toBeNull();
    expect(reminderDay(task({ notifyDaysBefore: 0 }), now)).toBeNull(); // due tomorrow, not today
  });

  it('uses the local day, not the UTC one', () => {
    // 23:30 UTC on the 9th is 01:30 on the 10th in Kyiv: on-the-day reminder at 01:00 is due.
    expect(reminderDay(task({ notifyDaysBefore: 0, notifyTime: '01:00' }), new Date('2026-11-09T23:30:00Z'))).toEqual(
      new Date('2026-11-10T00:00:00Z')
    );
  });

  it('reminds for each undone occurrence of a recurring series', () => {
    const daily = task({
      recurrence: Recurrence.daily,
      notifyDaysBefore: 0,
      dueDate: new Date('2026-11-01T00:00:00Z'),
    });
    expect(reminderDay(daily, new Date('2026-11-09T08:00:00Z'))).toEqual(new Date('2026-11-09T00:00:00Z'));
    expect(
      reminderDay({ ...daily, completedDates: [new Date('2026-11-09T00:00:00Z')] }, new Date('2026-11-09T08:00:00Z'))
    ).toBeNull();
  });
});

describe('notifyError', () => {
  it('validates only when a reminder is on', () => {
    expect(notifyError({ notifyDaysBefore: null })).toBeNull();
    expect(notifyError({ notifyDaysBefore: 1, notifyTime: '9:00' })).toMatch(/HH:MM/);
    expect(notifyError({ notifyDaysBefore: 1, notifyTime: '09:00', notifyTimeZone: 'Mars/Base' })).toMatch(/time zone/);
    expect(notifyError({ notifyDaysBefore: 1, notifyTime: '09:00', notifyTimeZone: 'Europe/Kyiv' })).toBeNull();
  });
});

describe('reminderBody', () => {
  it('speaks the device language, with Ukrainian plurals', () => {
    expect(reminderBody(3, 'en')).toBe('Due in 3 days');
    expect(reminderBody(1, 'uk')).toBe('Термін завтра');
    expect(reminderBody(3, 'uk')).toBe('Термін через 3 дні');
    expect(reminderBody(5, 'uk')).toBe('Термін через 5 днів');
  });
});
