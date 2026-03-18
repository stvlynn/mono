import {
  type AgentTool,
  type ChannelActionExecutor,
  type ChannelActionRequest,
  type ChannelActionResult,
  type ToolExecutionChannel,
  type ToolExecutionResult,
} from "@mono/shared";
import { z } from "zod";

const schema = z.object({
  channel: z.string().trim().optional(),
  action: z.string().trim().min(1),
  targetId: z.string().trim().optional(),
  messageId: z.union([z.string(), z.number()]).optional(),
  replyToMessageId: z.union([z.string(), z.number()]).optional(),
  threadId: z.union([z.string(), z.number()]).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export function createChannelActionTool(options: {
  channel: ToolExecutionChannel;
  executeChannelAction?: ChannelActionExecutor;
  availableActionsDescription?: string;
  recommendedActionDescription?: string;
}): AgentTool<ChannelActionRequest, ChannelActionResult> {
  return {
    name: "channel_action",
    description: [
      "Perform a platform-native action for the current messaging channel.",
      options.availableActionsDescription,
      options.recommendedActionDescription,
    ].filter(Boolean).join(" "),
    executionMode: "serial",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Optional channel identifier. Defaults to the current channel platform." },
        action: { type: "string", description: "Channel-native action name, such as send or sticker." },
        targetId: { type: "string", description: "Optional channel-native target id. Defaults to the current conversation target." },
        messageId: { anyOf: [{ type: "string" }, { type: "number" }] },
        replyToMessageId: { anyOf: [{ type: "string" }, { type: "number" }] },
        threadId: { anyOf: [{ type: "string" }, { type: "number" }] },
        payload: {
          type: "object",
          additionalProperties: true,
          description: "Channel-specific payload for the action.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    parseArgs: (input) => schema.parse(input),
    async execute(args): Promise<ToolExecutionResult<ChannelActionResult>> {
      if (!options.channel.platform) {
        throw new Error("channel_action requires a channel context");
      }
      if (!options.executeChannelAction) {
        throw new Error("Channel actions are unavailable because no channel executor is registered");
      }

      const normalized = {
        ...args,
        ...(args.channel?.trim() ? { channel: args.channel.trim() } : { channel: options.channel.platform }),
        ...(args.targetId?.trim() ? { targetId: args.targetId.trim() } : { targetId: options.channel.id }),
      };
      const result = await options.executeChannelAction(normalized, {
        channel: options.channel,
      });

      return {
        content: JSON.stringify(result, null, 2),
        details: result,
      };
    },
  };
}
