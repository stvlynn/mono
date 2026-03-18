import {
  type AgentTool,
  type ChannelStoreExecutor,
  type ChannelStoreRequest,
  type ChannelStoreResult,
  type ToolExecutionChannel,
  type ToolExecutionResult,
} from "@mono/shared";
import { z } from "zod";

const schema = z.object({
  channel: z.string().trim().optional(),
  resource: z.string().trim().min(1),
  action: z.enum(["list", "search", "upsert"]),
  entry: z.record(z.string(), z.unknown()).optional(),
}).superRefine((input, context) => {
  if (input.action !== "upsert") {
    return;
  }

  if (input.resource !== "sticker_source") {
    return;
  }

  const packId = typeof input.entry?.packId === "string" ? input.entry.packId.trim() : "";
  const emoji = typeof input.entry?.emoji === "string" ? input.entry.emoji.trim() : "";
  const fileId = typeof input.entry?.fileId === "string" ? input.entry.fileId.trim() : "";
  const telegramSetName =
    typeof input.entry?.telegramSetName === "string" ? input.entry.telegramSetName.trim() : "";
  const hasSticker = Boolean(packId && emoji && fileId);
  const hasTelegramSet = Boolean(packId && telegramSetName);
  if (!hasSticker && !hasTelegramSet) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sticker_source upsert requires packId with either telegramSetName or emoji + fileId",
      path: ["entry"],
    });
  }
});

export function createChannelStoreTool(options: {
  channel: ToolExecutionChannel;
  executeChannelStore?: ChannelStoreExecutor;
}): AgentTool<ChannelStoreRequest, ChannelStoreResult> {
  return {
    name: "channel_store",
    description: "List, search, or update a reusable channel-native source store, such as a sticker source mapping.",
    executionMode: "serial",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        resource: { type: "string" },
        action: { type: "string", enum: ["list", "search", "upsert"] },
        entry: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["resource", "action"],
      additionalProperties: false,
    },
    parseArgs: (input) => schema.parse(input),
    async execute(args): Promise<ToolExecutionResult<ChannelStoreResult>> {
      const channel = args.channel?.trim() || options.channel.platform;
      if (channel !== options.channel.platform) {
        const result = {
          ok: false,
          channel,
          resource: args.resource,
          action: args.action,
          reason: "unsupported_channel_resource",
        } satisfies ChannelStoreResult;
        return {
          content: JSON.stringify(result, null, 2),
          details: result,
        };
      }
      if (!options.executeChannelStore) {
        const result = {
          ok: false,
          channel,
          resource: args.resource,
          action: args.action,
          reason: "channel_store_unavailable",
        } satisfies ChannelStoreResult;
        return {
          content: JSON.stringify(result, null, 2),
          details: result,
        };
      }

      const result = await options.executeChannelStore({ ...args, channel }, {
        channel: options.channel,
      });
      return {
        content: JSON.stringify(result, null, 2),
        details: result,
      };
    },
  };
}
