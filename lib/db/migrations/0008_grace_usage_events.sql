-- Completed generation usage only; token counts remain NULL when not reported.
CREATE TABLE "GraceUsageEvent" (
  "callId" text PRIMARY KEY,
  "userId" uuid NOT NULL REFERENCES "User"("id"),
  "chatId" uuid REFERENCES "Chat"("id") ON DELETE SET NULL,
  "model" varchar(300) NOT NULL,
  "inputTokens" integer CHECK ("inputTokens" >= 0),
  "outputTokens" integer CHECK ("outputTokens" >= 0),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "GraceUsageEvent_createdAt_idx" ON "GraceUsageEvent" ("createdAt" DESC);
--> statement-breakpoint
ALTER TABLE "GraceUsageEvent" ENABLE ROW LEVEL SECURITY;
