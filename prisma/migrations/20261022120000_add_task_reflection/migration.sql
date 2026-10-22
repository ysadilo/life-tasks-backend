-- CreateEnum
CREATE TYPE "Feeling" AS ENUM ('drained', 'heavy', 'neutral', 'good', 'great');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "actualMinutes" INTEGER,
ADD COLUMN     "feeling" "Feeling";
