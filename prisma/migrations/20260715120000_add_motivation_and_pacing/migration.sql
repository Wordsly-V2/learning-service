-- AlterTable: leech handling on word_progress
ALTER TABLE "word_progress"
    ADD COLUMN IF NOT EXISTS "is_leech" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMPTZ;

-- Backfill: flag existing cards that have already lapsed past the default threshold.
UPDATE "word_progress" SET "is_leech" = true WHERE "lapses" >= 8;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "word_progress_userLoginId_is_leech_idx" ON "word_progress"("userLoginId", "is_leech");

-- CreateTable: persisted unlocked achievements
CREATE TABLE IF NOT EXISTS "user_achievement" (
    "user_login_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "unlocked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "xp_awarded" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_achievement_pkey" PRIMARY KEY ("user_login_id", "key")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_achievement_user_login_id_unlocked_at_idx" ON "user_achievement"("user_login_id", "unlocked_at" DESC);

-- CreateTable: push notification preferences (one row per user)
CREATE TABLE IF NOT EXISTS "notification_preference" (
    "user_login_id" UUID NOT NULL,
    "streak_reminder_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_time" TEXT NOT NULL DEFAULT '19:00',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "last_reminder_sent_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("user_login_id")
);

-- CreateTable: web push subscriptions (one row per browser/device endpoint)
CREATE TABLE IF NOT EXISTS "push_subscription" (
    "id" UUID NOT NULL,
    "user_login_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "push_subscription_user_login_id_idx" ON "push_subscription"("user_login_id");

-- CreateTable: per-user learning pacing + leech configuration
CREATE TABLE IF NOT EXISTS "user_learning_settings" (
    "user_login_id" UUID NOT NULL,
    "daily_new_word_limit" INTEGER NOT NULL DEFAULT 10,
    "daily_review_limit" INTEGER NOT NULL DEFAULT 100,
    "leech_threshold" INTEGER NOT NULL DEFAULT 8,
    "leech_auto_suspend" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_learning_settings_pkey" PRIMARY KEY ("user_login_id")
);
