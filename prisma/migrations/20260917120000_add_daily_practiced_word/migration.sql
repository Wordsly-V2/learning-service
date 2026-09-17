-- CreateTable: one row per (user, day, word) the learner practised.
--
-- The primary key is the "a word counts once per day" rule for XP and for the
-- daily goal. Both used to be per-answer — XP paid for every answer, and the
-- goal's word count was a number the client sent and the server summed — so
-- re-answering the same ten words made a ten-word day look like twenty. That
-- mattered little while the scheduler picked the words; a hand-picked
-- saved-words session turns it into a button.
--
-- No backfill: there is no per-review history to reconstruct one from, and an
-- empty ledger only means the words already practised today can be counted once
-- more. Every later day is correct.
CREATE TABLE IF NOT EXISTS "daily_practiced_word" (
    "user_login_id" UUID        NOT NULL,
    "practice_date" DATE        NOT NULL,
    "word_id"       UUID        NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_practiced_word_pkey" PRIMARY KEY ("user_login_id", "practice_date", "word_id")
);
