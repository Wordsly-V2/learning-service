-- AlterTable: streak freeze (Duolingo-style streak protection)
ALTER TABLE "daily_habit" ADD COLUMN "streak_freezes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "daily_habit" ADD COLUMN "last_freeze_used_date" DATE;
