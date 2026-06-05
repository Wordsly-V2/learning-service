-- AlterTable
ALTER TABLE "daily_habit" ADD COLUMN "daily_goal" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "daily_habit" ADD COLUMN "longest_streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "daily_habit" ADD COLUMN "goal_streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "daily_habit" ADD COLUMN "longest_goal_streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "daily_habit" ADD COLUMN "last_goal_met_date" DATE;
ALTER TABLE "daily_habit" ADD COLUMN "total_words_practiced" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "daily_habit" ADD COLUMN "total_practice_days" INTEGER NOT NULL DEFAULT 0;

-- Backfill longest streak from current streak for existing rows
UPDATE "daily_habit" SET "longest_streak" = "streak" WHERE "streak" > 0;

-- CreateTable
CREATE TABLE "daily_habit_day" (
    "user_login_id" UUID NOT NULL,
    "practice_date" DATE NOT NULL,
    "words_practiced" INTEGER NOT NULL DEFAULT 0,
    "goal_met" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "daily_habit_day_pkey" PRIMARY KEY ("user_login_id","practice_date")
);

-- CreateIndex
CREATE INDEX "daily_habit_day_user_login_id_practice_date_idx" ON "daily_habit_day"("user_login_id", "practice_date" DESC);

-- AddForeignKey
ALTER TABLE "daily_habit_day" ADD CONSTRAINT "daily_habit_day_user_login_id_fkey" FOREIGN KEY ("user_login_id") REFERENCES "daily_habit"("user_login_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill today's activity from daily_habit snapshot
INSERT INTO "daily_habit_day" ("user_login_id", "practice_date", "words_practiced", "goal_met")
SELECT
    "user_login_id",
    "practice_date",
    "words_today",
    "words_today" >= "daily_goal"
FROM "daily_habit"
WHERE "words_today" > 0
ON CONFLICT DO NOTHING;
