import type { InferSelectModel } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const user = pgTable("User", {
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  email: varchar("email", { length: 64 }).notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  name: text("name"),
  password: varchar("password", { length: 64 }),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable("Chat", {
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  title: text("title").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable("Message_v2", {
  attachments: json("attachments").notNull(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id),
  createdAt: timestamp("createdAt").notNull(),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  parts: json("parts").notNull(),
  role: varchar("role").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    isUpvoted: boolean("isUpvoted").notNull(),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.messageId] }),
  })
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "Document",
  {
    content: text("content"),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    kind: varchar("text", { enum: ["text", "code", "image", "sheet"] })
      .notNull()
      .default("text"),
    title: text("title").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.createdAt] }),
  })
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "Suggestion",
  {
    createdAt: timestamp("createdAt").notNull(),
    description: text("description"),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    documentId: uuid("documentId").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    isResolved: boolean("isResolved").notNull().default(false),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "Stream",
  {
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    id: uuid("id").notNull().defaultRandom(),
  },
  (table) => ({
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
    pk: primaryKey({ columns: [table.id] }),
  })
);

export type Stream = InferSelectModel<typeof stream>;

// Server-managed catalog. A discovered listing is not proof of inference access.
export const graceProviderKey = pgTable(
  "GraceProviderKey",
  {
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    discoveryStatus: varchar("discoveryStatus", { length: 32 })
      .notNull()
      .default("pending"),
    enabled: boolean("enabled").notNull().default(false),
    encryptedCredential: jsonb("encryptedCredential").notNull(),
    id: uuid("id").primaryKey().notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    lastDiscoveryAt: timestamp("lastDiscoveryAt", { withTimezone: true }),
    priority: integer("priority").notNull().default(50),
    provider: varchar("provider", { length: 32 }).notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({ identity: unique().on(table.id, table.provider) })
);

export const graceModel = pgTable(
  "GraceModel",
  {
    enabled: boolean("enabled").notNull().default(false),
    firstDiscoveredAt: timestamp("firstDiscoveredAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    lastDiscoveredAt: timestamp("lastDiscoveredAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    name: varchar("name", { length: 300 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    upstreamId: varchar("upstreamId", { length: 300 }).notNull(),
  },
  (table) => ({
    identity: unique().on(table.id, table.provider),
    upstream: unique().on(table.provider, table.upstreamId),
  })
);

export const graceKeyModel = pgTable(
  "GraceKeyModel",
  {
    available: boolean("available").notNull().default(false),
    keyId: uuid("keyId").notNull(),
    lastDiscoveredAt: timestamp("lastDiscoveredAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    modelId: uuid("modelId").notNull(),
    permitted: boolean("permitted").notNull().default(false),
    provider: varchar("provider", { length: 32 }).notNull(),
    verifiedAt: timestamp("verifiedAt", { withTimezone: true }),
  },
  (table) => ({
    keyRef: foreignKey({
      columns: [table.keyId, table.provider],
      foreignColumns: [graceProviderKey.id, graceProviderKey.provider],
    }).onDelete("cascade"),
    lookup: index("grace_key_model_lookup").on(table.modelId, table.permitted),
    modelRef: foreignKey({
      columns: [table.modelId, table.provider],
      foreignColumns: [graceModel.id, graceModel.provider],
    }).onDelete("cascade"),
    pk: primaryKey({ columns: [table.keyId, table.modelId] }),
  })
);

export const graceRateLimit = pgTable(
  "GraceRateLimit",
  {
    count: integer("count").notNull(),
    key: text("key").primaryKey(),
    windowStart: timestamp("windowStart", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    expiry: index("GraceRateLimit_windowStart_idx").on(table.windowStart),
  })
);

export const graceAdministrator = pgTable("GraceAdministrator", {
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  enabled: boolean("enabled").notNull().default(true),
  lastTotpStep: bigint("lastTotpStep", { mode: "number" })
    .notNull()
    .default(-1),
  role: varchar("role", { length: 16 }).notNull(),
  totpSecret: jsonb("totpSecret").notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userId: uuid("userId")
    .primaryKey()
    .references(() => user.id),
});

export const graceAdminAudit = pgTable(
  "GraceAdminAudit",
  {
    action: varchar("action", { length: 64 }).notNull(),
    actorId: uuid("actorId")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: uuid("id").primaryKey().defaultRandom(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    target: varchar("target", { length: 128 }),
  },
  (table) => ({
    created: index("GraceAdminAudit_createdAt_idx").on(table.createdAt.desc()),
  })
);

export const graceUsageEvent = pgTable(
  "GraceUsageEvent",
  {
    callId: text("callId").primaryKey(),
    chatId: uuid("chatId").references(() => chat.id, { onDelete: "set null" }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    inputTokens: integer("inputTokens"),
    model: varchar("model", { length: 300 }).notNull(),
    outputTokens: integer("outputTokens"),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    created: index("GraceUsageEvent_createdAt_idx").on(table.createdAt.desc()),
  })
);
