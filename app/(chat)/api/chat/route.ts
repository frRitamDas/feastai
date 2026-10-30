import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth } from "@/app/(auth)/auth";
import {
  allowedModelIds,
  chatModels,
  getCapabilities,
  getModelAvailability,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessagesByChatId,
  getPrivateAttachment,
  recordUsage,
  reserveChatQuota,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { enforceIpRateLimit } from "@/lib/ratelimit";
import { getRuntimeCatalog } from "@/lib/server/catalog/runtime";
import { isSameOrigin } from "@/lib/server/conversations/authorization";
import { createFallbackModel } from "@/lib/server/providers/fallback";
import { attachmentId } from "@/lib/server/security/attachments";
import { readLimitedJson } from "@/lib/server/security/read-limited-json";
import { mergeToolApprovals } from "@/lib/server/security/tool-approvals";
import type { ChatMessage, WaitingStatusData } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

const HEALTH_CHECK_DELAY_MS = 9000;

function isModelStreamActivity(chunk: { type: string }) {
  return !["start", "start-step", "finish-step", "finish", "raw"].includes(
    chunk.type
  );
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return new ChatbotError("forbidden:api").toResponse();
  }
  let requestBody: PostRequestBody;

  try {
    const json = await readLimitedJson(request, 1_000_000);
    requestBody = postRequestBodySchema.parse(json);
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const [botIdResult, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (botIdResult?.isBot || (isProductionEnvironment && !botIdResult)) {
      return new ChatbotError("forbidden:api").toResponse();
    }

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    await enforceIpRateLimit(ipAddress(request), "chat");
    let sharedModels: Awaited<
      ReturnType<
        NonNullable<ReturnType<typeof getRuntimeCatalog>>["resolveCandidates"]
      >
    > = [];
    if (
      selectedChatModel.startsWith("grace/") ||
      selectedChatModel.startsWith("auto/")
    ) {
      const catalog = getRuntimeCatalog();
      const isAutomatic = selectedChatModel.startsWith("auto/");
      const modelId = selectedChatModel.slice(
        isAutomatic ? "auto/".length : "grace/".length
      );
      if (
        !catalog ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          modelId
        )
      ) {
        return new ChatbotError(
          "bad_request:api",
          "The selected model is unavailable."
        ).toResponse();
      }
      sharedModels = isAutomatic
        ? await catalog.resolveRouteCandidates(modelId)
        : await catalog.resolveCandidates(modelId);
      if (!sharedModels.length) {
        return new ChatbotError(
          "bad_request:api",
          "The selected model is unavailable."
        ).toResponse();
      }
    } else if (!allowedModelIds.has(selectedChatModel)) {
      return new ChatbotError(
        "bad_request:api",
        "The selected model is unavailable."
      ).toResponse();
    }
    const [sharedModel] = sharedModels;
    const chatModel = selectedChatModel;

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    }
    if (!(await reserveChatQuota(session.user.id))) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }
    if (!chat && message?.role === "user") {
      await saveChat({
        id,
        title: "New chat",
        userId: session.user.id,
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const merged = mergeToolApprovals(
        convertToUIMessages(messagesFromDb),
        messages
      );
      if (!merged) {
        return new ChatbotError(
          "bad_request:api",
          "No matching pending approval."
        ).toResponse();
      }
      uiMessages = merged;
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    if (
      sharedModel &&
      (isToolApprovalFlow ||
        uiMessages.some((item) =>
          item.parts.some(
            (part) =>
              (part.type === "file" && part.mediaType !== "text/plain") ||
              part.type === "dynamic-tool" ||
              part.type.startsWith("tool-")
          )
        ))
    ) {
      return new ChatbotError(
        "bad_request:api",
        "This model currently supports text-only conversations without tools."
      ).toResponse();
    }

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;
    const fileParts = uiMessages.flatMap((item) =>
      item.parts.filter((part) => part.type === "file")
    );
    if (
      fileParts.length &&
      (fileParts.length > 10 ||
        (capabilities?.vision !== true &&
          fileParts.some(
            (part) => part.type === "file" && part.mediaType !== "text/plain"
          )))
    ) {
      return new ChatbotError(
        "bad_request:api",
        "Select a vision-capable model for images and use at most 10 attachments."
      ).toResponse();
    }
    const loaded = await Promise.all(
      fileParts.map(async (part) => {
        if (part.type !== "file") {
          return null;
        }
        const fileId = attachmentId(part.url, request.url);
        if (!fileId) {
          return null;
        }
        const file = await getPrivateAttachment(session.user.id, fileId);
        return file?.mediaType === part.mediaType ? file : null;
      })
    );
    if (
      loaded.some((file) => !file) ||
      loaded.reduce((total, file) => total + (file?.data.length ?? 0), 0) >
        4 * 1024 * 1024
    ) {
      return new ChatbotError(
        "bad_request:api",
        "Attachments are unavailable or exceed the 4 MB conversation limit."
      ).toResponse();
    }
    let fileIndex = 0;
    const modelInput = uiMessages.map((item) => ({
      ...item,
      parts: item.parts.map((part) => {
        if (part.type !== "file") {
          return part;
        }
        const file = loaded[fileIndex];
        fileIndex += 1;
        if (!file) {
          throw new Error("Attachment unavailable");
        }
        if (file.mediaType === "text/plain") {
          return {
            text: `Attached text file ${file.name}:\n\n${file.data.toString("utf8")}`,
            type: "text" as const,
          };
        }
        return {
          ...part,
          url: `data:${file.mediaType};base64,${file.data.toString("base64")}`,
        };
      }),
    }));

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      city,
      country,
      latitude,
      longitude,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            attachments: [],
            chatId: id,
            createdAt: new Date(),
            id: message.id,
            parts: message.parts,
            role: "user",
          },
        ],
      });
    }

    const modelMessages = await convertToModelMessages(modelInput);

    let actualProvider: { provider: string; upstreamId: string } | undefined;
    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelName = modelConfig?.name ?? chatModel;
        let hasModelActivity = false;
        let healthCheckTimer: ReturnType<typeof setTimeout> | undefined;

        const clearHealthCheckTimer = () => {
          if (healthCheckTimer) {
            clearTimeout(healthCheckTimer);
          }
        };

        const writeWaitingStatus = (
          phase: WaitingStatusData["phase"],
          messageText: string
        ) => {
          if (hasModelActivity && phase !== "thinking") {
            return;
          }
          dataStream.write({
            data: {
              message: messageText,
              modelId: chatModel,
              modelName,
              phase,
            },
            transient: true,
            type: "data-waiting-status",
          });
        };

        writeWaitingStatus("waiting", "Waiting...");

        healthCheckTimer = setTimeout(() => {
          getModelAvailability(chatModel)
            .then((availability) => {
              if (availability === "impacted") {
                writeWaitingStatus(
                  "health",
                  `${modelName} may be slow or unavailable right now...`
                );
              } else {
                writeWaitingStatus("still-waiting", "Still waiting...");
              }
            })
            .catch(() => {
              writeWaitingStatus("still-waiting", "Still waiting...");
            });
        }, HEALTH_CHECK_DELAY_MS);

        const markModelActive = () => {
          if (hasModelActivity) {
            return;
          }
          hasModelActivity = true;
          clearHealthCheckTimer();
          writeWaitingStatus("thinking", "Thinking...");
        };

        const stopWaitingStatus = () => {
          hasModelActivity = true;
          clearHealthCheckTimer();
        };

        const result = streamText({
          activeTools:
            sharedModel || (isReasoningModel && !supportsTools)
              ? []
              : [
                  "getWeather",
                  "createDocument",
                  "editDocument",
                  "updateDocument",
                  "requestSuggestions",
                ],
          instructions: systemPrompt({ requestHints, supportsTools }),
          messages: modelMessages,
          model: sharedModel
            ? createFallbackModel(sharedModels, undefined, (selected) => {
                actualProvider = selected;
              })
            : getLanguageModel(chatModel),
          ...(sharedModel
            ? {
                abortSignal: AbortSignal.any([
                  request.signal,
                  AbortSignal.timeout(55_000),
                ]),
                maxRetries: 0,
              }
            : {}),
          onAbort() {
            stopWaitingStatus();
          },
          onChunk({ chunk }) {
            if (isModelStreamActivity(chunk)) {
              markModelActive();
            }
          },
          async onEnd({ callId, usage }) {
            stopWaitingStatus();
            try {
              await recordUsage({
                callId,
                chatId: id,
                inputTokens: usage.inputTokens,
                model: chatModel,
                outputTokens: usage.outputTokens,
                provider: actualProvider?.provider,
                upstreamModel: actualProvider?.upstreamId,
                userId: session.user.id,
              });
            } catch {
              console.error("Unable to record generation usage");
            }
          },
          onError() {
            stopWaitingStatus();
          },
          providerOptions: {
            ...(modelConfig?.gatewayOrder && {
              gateway: { order: modelConfig.gatewayOrder },
            }),
            ...(modelConfig?.reasoningEffort && {
              openai: { reasoningEffort: modelConfig.reasoningEffort },
            }),
          },
          stopWhen: isStepCount(5),
          telemetry: {
            functionId: "stream-text",
            isEnabled: isProductionEnvironment,
          },
          tools: {
            createDocument: createDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
            editDocument: editDocument({ dataStream, session }),
            getWeather,
            requestSuggestions: requestSuggestions({
              dataStream,
              modelId: chatModel,
              session,
            }),
            updateDocument: updateDocument({
              dataStream,
              modelId: chatModel,
              session,
            }),
          },
        });

        dataStream.merge(
          toUIMessageStream({
            sendReasoning: isReasoningModel,
            stream: result.stream,
          })
        );

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({ data: title, type: "data-chat-title" });
            updateChatTitleById({ chatId: id, title });
          } catch {
            /* non-fatal */
          }
        }
      },
      generateId: generateUUID,
      onEnd: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          await Promise.all(
            finishedMessages.map(async (finishedMsg) => {
              const existingMsg = uiMessages.find(
                (m) => m.id === finishedMsg.id
              );
              if (existingMsg) {
                await updateMessage({
                  id: finishedMsg.id,
                  parts: finishedMsg.parts,
                });
                return;
              }

              await saveMessages({
                messages: [
                  {
                    attachments: [],
                    chatId: id,
                    createdAt: new Date(),
                    id: finishedMsg.id,
                    parts: finishedMsg.parts,
                    role: finishedMsg.role,
                  },
                ],
              });
            })
          );
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              attachments: [],
              chatId: id,
              createdAt: new Date(),
              id: currentMessage.id,
              parts: currentMessage.parts,
              role: currentMessage.role,
            })),
          });
        }
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
        return "Oops, an error occurred!";
      },
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
    });

    return createUIMessageStreamResponse({
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ chatId: id, streamId });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
      stream,
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request.url, request.headers.get("origin"))) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
