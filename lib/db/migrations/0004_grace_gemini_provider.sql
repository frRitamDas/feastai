-- Expand the allowed provider set; existing keys and permissions are preserved.
ALTER TABLE "GraceProviderKey" DROP CONSTRAINT "GraceProviderKey_provider_check";
--> statement-breakpoint
ALTER TABLE "GraceProviderKey" ADD CONSTRAINT "GraceProviderKey_provider_check"
  CHECK ("provider" IN ('groq', 'openrouter', 'cerebras', 'sambanova', 'mistral', 'gemini'));
