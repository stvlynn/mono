import { describe, expect, it } from "vitest";
import { createChannelStoreTool } from "../packages/tools/src/telegram-sticker-store.js";

describe("channel store tool", () => {
  it("forwards a list request to the channel store executor", async () => {
    const tool = createChannelStoreTool({
      channel: {
        platform: "telegram",
        kind: "dm",
        id: "7001",
      },
      executeChannelStore: async (request) => ({
        ok: true,
        channel: String(request.channel ?? "telegram"),
        resource: request.resource,
        action: request.action,
        path: "/workspace/.mono/telegram/stickers.json",
        entryCount: 0,
      }),
    });

    const result = await tool.execute({
      resource: "sticker_source",
      action: "list",
    }, { toolCallId: "tool-1" });

    expect(result.details).toEqual({
      ok: true,
      channel: "telegram",
      resource: "sticker_source",
      action: "list",
      path: "/workspace/.mono/telegram/stickers.json",
      entryCount: 0,
    });
  });

  it("returns unsupported_channel_resource for mismatched channels", async () => {
    const tool = createChannelStoreTool({
      channel: {
        platform: "telegram",
        kind: "dm",
        id: "7001",
      },
      executeChannelStore: async () => {
        throw new Error("should not be called");
      },
    });

    const result = await tool.execute({
      channel: "discord",
      resource: "sticker_source",
      action: "list",
    }, { toolCallId: "tool-1" });

    expect(result.details).toEqual({
      ok: false,
      channel: "discord",
      resource: "sticker_source",
      action: "list",
      reason: "unsupported_channel_resource",
    });
  });

  it("forwards a search request to the channel store executor", async () => {
    const tool = createChannelStoreTool({
      channel: {
        platform: "telegram",
        kind: "dm",
        id: "7001",
      },
      executeChannelStore: async (request) => ({
        ok: true,
        channel: String(request.channel ?? "telegram"),
        resource: request.resource,
        action: request.action,
        count: 1,
        items: [{ fileId: "CAAC456", emoji: "😺", setName: "CatsPack" }],
      }),
    });

    const result = await tool.execute({
      resource: "sticker_source",
      action: "search",
      entry: {
        setName: "CatsPack",
        excludeFileId: "CAAC123",
      },
    }, { toolCallId: "tool-2" });

    expect(result.details).toEqual({
      ok: true,
      channel: "telegram",
      resource: "sticker_source",
      action: "search",
      count: 1,
      items: [{ fileId: "CAAC456", emoji: "😺", setName: "CatsPack" }],
    });
  });
});
