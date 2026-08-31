-- A day covered by a banked streak freeze: no practice, but the streak chain
-- survives it. Recorded so the streak recompute can bridge the gap.
ALTER TABLE "daily_habit_day" ADD COLUMN "frozen" BOOLEAN NOT NULL DEFAULT false;

-- Days the daily goal was met (totalPracticeDays counts any practice).
ALTER TABLE "daily_habit" ADD COLUMN "total_goal_days" INTEGER NOT NULL DEFAULT 0;

UPDATE "daily_habit" h
SET "total_goal_days" = (
  SELECT COUNT(*)
  FROM "daily_habit_day" d
  WHERE d."user_login_id" = h."user_login_id"
    AND d."goal_met"
);
