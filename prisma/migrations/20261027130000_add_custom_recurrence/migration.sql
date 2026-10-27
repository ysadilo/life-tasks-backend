-- CreateEnum
CREATE TYPE "RecurrenceUnit" AS ENUM ('day', 'week', 'month');

-- AlterEnum
ALTER TYPE "Recurrence" ADD VALUE 'custom';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "recurrenceInterval" INTEGER,
ADD COLUMN     "recurrenceUnit" "RecurrenceUnit";
