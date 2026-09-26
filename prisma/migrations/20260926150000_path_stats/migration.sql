-- AlterTable
ALTER TABLE "daily_review_stat" ADD COLUMN     "path_correct_reviews" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "path_reviews" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "path_progress_totals" (
    "user_login_id" UUID NOT NULL,
    "lessons_completed" INTEGER NOT NULL DEFAULT 0,
    "units_completed" INTEGER NOT NULL DEFAULT 0,
    "stages_completed" INTEGER NOT NULL DEFAULT 0,
    "reported_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "path_progress_totals_pkey" PRIMARY KEY ("user_login_id")
);
