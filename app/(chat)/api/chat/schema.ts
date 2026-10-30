import { z } from "zod";

const textPartSchema = z.object({
  text: z.string().min(1).max(2000),
  type: z.enum(["text"]),
});

const filePartSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "text/plain"]),
  name: z.string().min(1).max(100),
  type: z.enum(["file"]),
  url: z.url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.uuid(),
  parts: z.array(partSchema).min(1).max(20),
  role: z.enum(["user"]),
});

const toolApprovalMessageSchema = z.object({
  id: z.string().min(1).max(128),
  parts: z.array(z.record(z.string(), z.unknown())).max(100),
  role: z.enum(["user", "assistant"]),
});

export const postRequestBodySchema = z
  .object({
    id: z.uuid(),
    message: userMessageSchema.optional(),
    messages: z.array(toolApprovalMessageSchema).min(1).max(500).optional(),
    selectedChatModel: z.string().min(1).max(300),
    selectedVisibilityType: z.enum(["public", "private"]),
  })
  .refine((value) => Boolean(value.message) !== Boolean(value.messages));

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
