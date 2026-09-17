-- CreateTable: words the learner has flagged as hard, to come back to on purpose.
--
-- Kept out of `word_progress` on purpose: that row only exists once a word has
-- been answered, and resetting progress deletes it, so a bookmark stored there
-- would disappear with the schedule it was meant to outlive.
CREATE TABLE IF NOT EXISTS "saved_word" (
    "user_login_id" UUID        NOT NULL,
    "word_id"       UUID        NOT NULL,
    "note"          TEXT,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_word_pkey" PRIMARY KEY ("user_login_id", "word_id")
);

-- Newest-first listing for one learner.
CREATE INDEX IF NOT EXISTS "saved_word_user_login_id_created_at_idx"
    ON "saved_word" ("user_login_id", "created_at" DESC);

-- Fan-out delete when vocabulary-service reports a word gone.
CREATE INDEX IF NOT EXISTS "saved_word_word_id_idx" ON "saved_word" ("word_id");
