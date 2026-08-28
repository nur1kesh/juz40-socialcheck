CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "document_type" TEXT,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "application_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_logs_created_at_idx" ON "ai_usage_logs"("created_at");
CREATE INDEX "ai_usage_logs_model_idx" ON "ai_usage_logs"("model");
