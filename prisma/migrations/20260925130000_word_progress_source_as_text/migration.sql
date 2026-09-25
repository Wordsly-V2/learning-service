-- No database enums (workspace rule): `source` becomes TEXT and the allowed
-- values ('VOCAB', 'PATH') live in src/word-scope/item-source.ts.
ALTER TABLE "word_progress" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "word_progress" ALTER COLUMN "source" TYPE TEXT USING "source"::TEXT;
ALTER TABLE "word_progress" ALTER COLUMN "source" SET DEFAULT 'VOCAB';

DROP TYPE "ItemSource";
