-- CreateTable: one-shot ledger for per-day consistency XP.
--
-- "First practice of the day" and "daily goal met" XP were crossing grants keyed
-- off a mutable cursor on `daily_habit`, so a replayed or backdated offline
-- flush could pay them again. Ledgering them per (user, date, kind) makes the
-- primary key the guarantee instead.
--
-- The seed below backfills every day the user has already practised, so an
-- existing day cannot be re-paid. Idempotent via ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS "daily_habit_grant" (
    "user_login_id" UUID        NOT NULL,
    "practice_date" DATE        NOT NULL,
    "kind"          TEXT        NOT NULL,
    "xp_awarded"    INTEGER     NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_habit_grant_pkey" PRIMARY KEY ("user_login_id", "practice_date", "kind")
);

-- Backfill: every recorded practice day already earned its first-practice XP,
-- and every goal-met day already earned its goal XP. Amounts match
-- XP_FIRST_PRACTICE_OF_DAY / XP_DAILY_GOAL_MET in user-level.logic.ts.
INSERT INTO "daily_habit_grant" ("user_login_id", "practice_date", "kind", "xp_awarded")
SELECT "user_login_id", "practice_date", 'first-practice', 10
FROM "daily_habit_day"
ON CONFLICT DO NOTHING;

INSERT INTO "daily_habit_grant" ("user_login_id", "practice_date", "kind", "xp_awarded")
SELECT "user_login_id", "practice_date", 'goal-met', 15
FROM "daily_habit_day"
WHERE "goal_met" = TRUE
ON CONFLICT DO NOTHING;
