-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "occurrenceCheckins" JSONB NOT NULL DEFAULT '{}';
