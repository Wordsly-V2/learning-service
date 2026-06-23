-- CreateTable: per-day review-accuracy aggregate for the learning progress report
CREATE TABLE "daily_review_stat" (
    "user_login_id" UUID NOT NULL,
    "review_date" DATE NOT NULL,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "correct_reviews" INTEGER NOT NULL DEFAULT 0,
    "new_words" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_review_stat_pkey" PRIMARY KEY ("user_login_id", "review_date")
);

-- CreateIndex
CREATE INDEX "daily_review_stat_user_login_id_review_date_idx" ON "daily_review_stat" ("user_login_id", "review_date" DESC);
