-- CreateTable: per-user app/UI preferences synced across devices (opaque JSON blob)
CREATE TABLE IF NOT EXISTS "user_preferences" (
    "user_login_id" UUID NOT NULL,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_login_id")
);
