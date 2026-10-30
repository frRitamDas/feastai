import { isProductionEnvironment } from "@/lib/constants";
import { incrementRateLimit } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  checkRateLimit,
  type RateLimitScope,
} from "@/lib/server/security/rate-limit";

/** Production fails closed when identity, secret, or the counter is unavailable. */
export async function enforceIpRateLimit(
  ip: string | undefined,
  scope: RateLimitScope
) {
  if (!isProductionEnvironment) {
    return;
  }
  let allowed: boolean;
  try {
    allowed = await checkRateLimit({
      increment: incrementRateLimit,
      ip,
      scope,
      secret: process.env.AUTH_SECRET,
    });
  } catch {
    // biome-ignore lint/style/useErrorCause: database errors can contain sensitive connection details
    throw new ChatbotError("offline:chat");
  }
  if (!allowed) {
    throw new ChatbotError("rate_limit:chat");
  }
}
