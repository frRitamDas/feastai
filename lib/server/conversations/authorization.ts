import { z } from "zod";

export const renameConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
  })
  .strict();

export function conversationAccess(
  sessionUserId: string | undefined,
  conversationOwnerId: string | undefined
): 200 | 401 | 404 {
  if (!sessionUserId) {
    return 401;
  }
  // Do not reveal whether a conversation belongs to someone else.
  return conversationOwnerId === sessionUserId ? 200 : 404;
}

/** Production uses an explicit external origin, not an internal proxy URL or
 * client-supplied forwarding headers. Preview environments need their own
 * AUTH_URL. Development uses the request origin for local testing. */
type OriginConfig = { production: boolean; authUrl?: string };

export function applicationOrigin(
  requestUrl: string,
  config?: OriginConfig
): string | null {
  const production =
    config?.production ?? process.env.NODE_ENV === "production";
  const value = production
    ? config
      ? config.authUrl
      : process.env.AUTH_URL
    : requestUrl;
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (production && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isSameOrigin(
  requestUrl: string,
  origin: string | null,
  config?: OriginConfig
): boolean {
  const expected = applicationOrigin(requestUrl, config);
  if (!origin || !expected) {
    return false;
  }
  try {
    return expected === new URL(origin).origin;
  } catch {
    return false;
  }
}
