ALTER TABLE "Task" ADD COLUMN "notifyDaysBefore" INTEGER,
ADD COLUMN "notifyTime" TEXT,
ADD COLUMN "notifyTimeZone" TEXT,
ADD COLUMN "lastNotifiedFor" TIMESTAMP(3);
