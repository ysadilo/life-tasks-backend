import { Energy, Feeling, Priority, Recurrence, TaskStatus } from '@prisma/client';

export enum ResolveMissedAction {
  done = 'done',
  dismiss = 'dismiss',
  addToday = 'addToday',
}

export class CreateTaskDto {
  title!: string;
  description?: string;
  dueDate?: string;
  areaId?: string | null;
  /** A member of the board, or null to leave the task unassigned. */
  assigneeId?: string | null;
  priority?: Priority;
  energy?: Energy;
  estimatedMinutes?: number;
  recurrence?: Recurrence;
  recurrenceEndDate?: string;
}

export class UpdateTaskDto {
  title?: string;
  description?: string;
  dueDate?: string;
  status?: TaskStatus;
  todayDate?: string;
  areaId?: string | null;
  /** A member of the board, or null to leave the task unassigned. */
  assigneeId?: string | null;
  priority?: Priority;
  energy?: Energy;
  estimatedMinutes?: number;
  feeling?: Feeling | null;
  actualMinutes?: number | null;
  recurrence?: Recurrence | null;
  recurrenceEndDate?: string | null;

  // Tick / untick one occurrence day of a recurring task (mutually exclusive with
  // the fields above — this is not a normal edit).
  occurrenceDate?: string;
  occurrenceDone?: boolean;

  // Resolve a recurring task's flagged missed occurrence (also mutually exclusive
  // with the fields above).
  resolveMissedAction?: ResolveMissedAction;
}
