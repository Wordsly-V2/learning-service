-- CreateTable
CREATE TABLE "word_progress" (
    "id" UUID NOT NULL,
    "wordId" UUID NOT NULL,
    "userLoginId" UUID NOT NULL,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "interval" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "last_reviewed_at" TIMESTAMPTZ,
    "next_review_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "correct_reviews" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "word_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "word_progress_userLoginId_next_review_at_idx" ON "word_progress"("userLoginId", "next_review_at");

-- CreateIndex
CREATE INDEX "word_progress_wordId_idx" ON "word_progress"("wordId");

-- CreateIndex
CREATE UNIQUE INDEX "word_progress_wordId_userLoginId_key" ON "word_progress"("wordId", "userLoginId");
