import "server-only";
import { randomInt } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { ChatbotError } from "../errors";
import { escapeSearchTerm } from "../server/conversations/search";
import { RESERVE_QUOTA_SQL } from "../server/security/quota";
import { RATE_LIMIT_SQL } from "../server/security/rate-limit";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  message,
  type Suggestion,
  stream,
  suggestion,
  type User,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

export async function getUserSessionState(id: string) {
  const rows = await client.unsafe<
    { enabled: boolean; sessionVersion: number }[]
  >(
    'SELECT COALESCE(p."enabled", true) AS "enabled", u."sessionVersion" FROM "User" u LEFT JOIN "GraceUserPolicy" p ON p."userId" = u."id" WHERE u."id" = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function getProfile(id: string) {
  const rows = await client.unsafe<
    {
      email: string;
      name: string | null;
      password: string | null;
      isAnonymous: boolean;
    }[]
  >(
    'SELECT "email", "name", "password", "isAnonymous" FROM "User" WHERE "id" = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function updateProfile(
  id: string,
  name: string,
  oldHash: string | null,
  newHash: string | null
) {
  if (newHash) {
    return (
      (
        await client.unsafe(
          'UPDATE "User" SET "name" = $2, "password" = $3, "sessionVersion" = "sessionVersion" + 1, "updatedAt" = now() WHERE "id" = $1 AND "password" = $4 RETURNING "id"',
          [id, name || null, newHash, oldHash]
        )
      ).length === 1
    );
  }
  return (
    (
      await client.unsafe(
        'UPDATE "User" SET "name" = $2, "updatedAt" = now() WHERE "id" = $1 RETURNING "id"',
        [id, name || null]
      )
    ).length === 1
  );
}

export async function reserveChatQuota(id: string): Promise<boolean> {
  const rows = await client.unsafe(RESERVE_QUOTA_SQL, [id]);
  return rows.length === 1;
}

export async function getSystemSettings() {
  const [settings] = await client.unsafe<
    { registrationEnabled: boolean; chatEnabled: boolean }[]
  >(
    'SELECT "registrationEnabled", "chatEnabled" FROM "GraceSystemSetting" WHERE "id" = 1'
  );
  if (!settings) {
    throw new Error("System settings unavailable");
  }
  return settings;
}

export async function getPublishedAnnouncements() {
  return await client.unsafe<{ id: string; title: string; body: string }[]>(
    'SELECT "id", "title", "body" FROM "GraceAnnouncement" WHERE "enabled" = true ORDER BY "createdAt" DESC LIMIT 10'
  );
}

export async function savePrivateAttachment(
  userId: string,
  name: string,
  mediaType: string,
  data: Buffer
) {
  return await client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('attachments:' || ${userId}))`;
    const [usage] = await tx<
      { size: number }[]
    >`SELECT COALESCE(sum(octet_length("data")), 0)::int AS size FROM "GraceAttachment" WHERE "userId" = ${userId}`;
    if (Number(usage.size) + data.length > 20 * 1024 * 1024) {
      return null;
    }
    const [row] = await tx<
      { id: string }[]
    >`INSERT INTO "GraceAttachment" ("userId", "name", "mediaType", "data") VALUES (${userId}, ${name}, ${mediaType}, ${data}) RETURNING "id"`;
    return row.id;
  });
}

export async function getPrivateAttachment(userId: string, id: string) {
  const rows = await client.unsafe<
    { id: string; name: string; mediaType: string; data: Buffer }[]
  >(
    'SELECT "id", "name", "mediaType", "data" FROM "GraceAttachment" WHERE "id" = $1 AND "userId" = $2',
    [id, userId]
  );
  return rows[0] ?? null;
}

/** Claim references before saving a message; deletion only accepts unclaimed files. */
export async function claimPrivateAttachments(userId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) {
    return true;
  }
  const rows = await client.unsafe(
    `UPDATE "GraceAttachment" SET "usedAt" = COALESCE("usedAt", now()) WHERE "userId" = $1 AND "id" IN (SELECT jsonb_array_elements_text($2::text::jsonb)::uuid) RETURNING "id"`,
    [userId, JSON.stringify(unique)]
  );
  return rows.length === unique.length;
}
export async function deleteUnusedAttachment(userId: string, id: string) {
  return (
    (
      await client.unsafe(
        'DELETE FROM "GraceAttachment" WHERE "userId" = $1 AND "id" = $2 AND "usedAt" IS NULL RETURNING "id"',
        [userId, id]
      )
    ).length > 0
  );
}
export async function clearUnusedAttachments(userId: string) {
  return (
    await client.unsafe(
      'DELETE FROM "GraceAttachment" WHERE "userId" = $1 AND "usedAt" IS NULL RETURNING "id"',
      [userId]
    )
  ).length;
}

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createUser(
  email: string,
  password: string
): Promise<boolean> {
  const hashedPassword = generateHashedPassword(password);
  try {
    return await client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(lower(${email})))`;
      const existing =
        await tx`SELECT "id" FROM "User" WHERE lower("email") = lower(${email}) LIMIT 1`;
      if (existing.length) {
        return false;
      }
      await tx`INSERT INTO "User" ("email", "password") VALUES (${email}, ${hashedPassword})`;
      return true;
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}${randomInt(100_000, 999_999)}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db
      .insert(user)
      .values({ email, isAnonymous: true, password })
      .returning({
        email: user.email,
        id: user.id,
        sessionVersion: user.sessionVersion,
      });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    return await db.insert(chat).values({
      createdAt: new Date(),
      id,
      title,
      userId,
      visibility,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    return await db.transaction(async (tx) => {
      await tx.delete(vote).where(eq(vote.chatId, id));
      await tx.delete(message).where(eq(message.chatId, id));
      await tx.delete(stream).where(eq(stream.chatId, id));
      const [deleted] = await tx
        .delete(chat)
        .where(eq(chat.id, id))
        .returning();
      return deleted;
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    return await db.transaction(async (tx) => {
      const userChats = await tx
        .select({ id: chat.id })
        .from(chat)
        .where(eq(chat.userId, userId));
      if (userChats.length === 0) {
        return { deletedCount: 0 };
      }
      const chatIds = userChats.map((item) => item.id);
      await tx.delete(vote).where(inArray(vote.chatId, chatIds));
      await tx.delete(message).where(inArray(message.chatId, chatIds));
      await tx.delete(stream).where(inArray(stream.chatId, chatIds));
      const deleted = await tx
        .delete(chat)
        .where(and(eq(chat.userId, userId), inArray(chat.id, chatIds)))
        .returning();
      return { deletedCount: deleted.length };
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(and(eq(chat.id, startingAfter), eq(chat.userId, id)))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(and(eq(chat.id, endingBefore), eq(chat.userId, id)))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      isUpvoted: type === "up",
      messageId,
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        content,
        createdAt: new Date(),
        id,
        kind,
        title,
        userId,
      })
      .returning();
  } catch (error) {
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  try {
    const docs = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt))
      .limit(1);

    const [latest] = docs;
    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }

    return await db
      .update(document)
      .set({ content })
      .where(and(eq(document.id, id), eq(document.createdAt, latest.createdAt)))
      .returning();
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
    throw new ChatbotError("bad_request:database", {
      cause: error,
    });
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    return await db.transaction(async (tx) => {
      await tx
        .delete(suggestion)
        .where(
          and(
            eq(suggestion.documentId, id),
            gt(suggestion.documentCreatedAt, timestamp)
          )
        );
      return await tx
        .delete(document)
        .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
        .returning();
    });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db
      .update(chat)
      .set({ title })
      .where(and(eq(chat.id, chatId), eq(chat.title, "New chat")));
  } catch {
    console.error("Unable to update generated conversation title");
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, cutoffTime),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ chatId, createdAt: new Date(), id: streamId });
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/** Atomic ownership check prevents a rename from affecting another user's chat. */
export async function renameOwnedChat({
  id,
  userId,
  title,
}: {
  id: string;
  userId: string;
  title: string;
}) {
  try {
    const [renamed] = await db
      .update(chat)
      .set({ title })
      .where(and(eq(chat.id, id), eq(chat.userId, userId)))
      .returning({ id: chat.id, title: chat.title });
    return renamed ?? null;
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/** Search only the caller's conversation titles; wildcard characters are literal. */
export async function searchChatsByUserId({
  id,
  query,
}: {
  id: string;
  query: string;
}) {
  try {
    const literal = escapeSearchTerm(query);
    return await db
      .select()
      .from(chat)
      .where(and(eq(chat.userId, id), ilike(chat.title, `%${literal}%`)))
      .orderBy(desc(chat.createdAt))
      .limit(50);
  } catch (error) {
    throw new ChatbotError("bad_request:database", { cause: error });
  }
}

/** Atomic distributed counter used only by trusted server-side callers. */
export async function incrementRateLimit(key: string): Promise<number> {
  const rows = await client.unsafe<{ count: number }[]>(RATE_LIMIT_SQL, [key]);
  return rows[0]?.count ?? 0;
}

/** Persist provider-reported token counts without inventing values when absent. */
export async function recordUsage({
  callId,
  userId,
  chatId,
  model,
  inputTokens,
  outputTokens,
  provider,
  upstreamModel,
}: {
  callId: string;
  userId: string;
  chatId: string;
  model: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  provider?: string | null;
  upstreamModel?: string | null;
}) {
  const valid = (value: number | undefined) =>
    Number.isSafeInteger(value) &&
    value !== undefined &&
    value >= 0 &&
    value <= 2_147_483_647
      ? value
      : null;
  await client.unsafe(
    'INSERT INTO "GraceUsageEvent" ("callId", "userId", "chatId", "model", "inputTokens", "outputTokens", "provider", "upstreamModel") VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT ("callId") DO NOTHING',
    [
      callId,
      userId,
      chatId,
      model,
      valid(inputTokens),
      valid(outputTokens),
      provider ?? null,
      upstreamModel ?? null,
    ]
  );
}
