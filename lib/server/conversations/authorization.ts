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

export function isSameOrigin(
  requestUrl: string,
  origin: string | null
): boolean {
  if (!origin) {
    return false;
  }
  try {
    return new URL(requestUrl).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
