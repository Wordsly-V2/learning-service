-- CreateTable: cumulative XP and derived learning level (one row per user)
CREATE TABLE "user_level" (
    "user_login_id" UUID NOT NULL,
    "total_xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_level_pkey" PRIMARY KEY ("user_login_id")
);
