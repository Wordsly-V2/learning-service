-- Wordsly Path: a card's item can now live in curriculum-service as well as in
-- the learner's own vocabulary-service library. Every existing row is a
-- vocabulary word, which the default states; a constant default makes this a
-- metadata-only change (no table rewrite).
CREATE TYPE "ItemSource" AS ENUM ('VOCAB', 'PATH');

ALTER TABLE "word_progress" ADD COLUMN "source" "ItemSource" NOT NULL DEFAULT 'VOCAB';

-- Path review reads one learner's due PATH cards in due order.
CREATE INDEX "word_progress_userLoginId_source_next_review_at_idx"
    ON "word_progress"("userLoginId", "source", "next_review_at");
