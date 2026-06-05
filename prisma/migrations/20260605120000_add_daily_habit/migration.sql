-- CreateTable
CREATE TABLE "daily_habit" (
    "user_login_id" UUID NOT NULL,
    "words_today" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "practice_date" DATE NOT NULL,
    "last_practice_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "daily_habit_pkey" PRIMARY KEY ("user_login_id")
);
