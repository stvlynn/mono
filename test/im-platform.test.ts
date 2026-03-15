import { describe, expect, it } from "vitest";
import {
  createBuiltInProvider,
  createDistributor,
  inboundMessageToTaskInput,
  ProviderNotFoundError,
  UnsupportedCapabilityError,
  UnsupportedContentError,
  UnsupportedTargetError,
  type BuiltInProviderConfig,
} from "@mono/im-platform";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function createFetchStub(responses: unknown[]) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      init,
    });
    const payload = responses.shift() ?? { ok: true, result: { message_id: 1, chat: { id: 1 } } };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };
  return { fetchImpl, calls };
}

function createTelegramConfig(fetchImpl: typeof fetch, id = "primary-dispatch"): BuiltInProviderConfig {
  return {
    platform: "telegram",
    id,
    botToken: "bot-token",
    fetchImpl,
  };
}

async function readJsonBody(call: FetchCall): Promise<Record<string, unknown>> {
  const body = call.init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected JSON body");
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function createTelegramInboundFetchStub() {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/getFile")) {
      return new Response(JSON.stringify({
        ok: true,
        result: {
          file_path: "photos/file_10.jpg",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("/file/bot")) {
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  return { fetchImpl, calls };
}

describe("@mono/im-platform", () => {
  it("dispatches markdown text to a channel through a configured provider alias", async () => {
    const { fetchImpl, calls } = createFetchStub([
      { ok: true, result: { message_id: 101, chat: { id: -1001001 } } },
    ]);
    const distributor = createDistributor({
      builtInProviders: [createTelegramConfig(fetchImpl, "announcements")],
    });

    const result = await distributor.dispatch({
      provider: "announcements",
      target: {
        kind: "channel",
        address: "@mono_channel",
      },
      content: {
        type: "text",
        text: "# Release Notes\n\n**Ready**",
        format: "markdown",
      },
    });

    expect(result.provider).toBe("announcements");
    expect(result.platform).toBe("telegram");
    expect(result.remoteChatId).toBe("-1001001");
    expect(result.remoteMessageIds).toEqual(["101"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.endsWith("/sendMessage")).toBe(true);

    const body = await readJsonBody(calls[0]!);
    expect(body.chat_id).toBe("@mono_channel");
    expect(body.parse_mode).toBe("HTML");
    expect(String(body.text)).toContain("<b>Release Notes</b>");
  });

  it("falls back to plain text when Telegram rejects HTML parsing", async () => {
    const { fetchImpl, calls } = createFetchStub([
      { ok: false, description: "Bad Request: can't parse entities" },
      { ok: true, result: { message_id: 102, chat: { id: 55 } } },
    ]);
    const distributor = createDistributor({
      builtInProviders: [createTelegramConfig(fetchImpl)],
    });

    const result = await distributor.dispatch({
      provider: "primary-dispatch",
      target: {
        kind: "dm",
        address: 55,
      },
      content: {
        type: "text",
        text: "**plain fallback**",
        format: "markdown",
      },
    });

    expect(result.remoteMessageIds).toEqual(["102"]);
    expect(calls).toHaveLength(2);

    const fallbackBody = await readJsonBody(calls[1]!);
    expect(fallbackBody.parse_mode).toBeUndefined();
    expect(fallbackBody.text).toBe("**plain fallback**");
  });

  it("maps dm topic ids to Telegram direct message topic ids", async () => {
    const { fetchImpl, calls } = createFetchStub([
      { ok: true, result: { message_id: 103, chat: { id: 77 } } },
    ]);
    const distributor = createDistributor({
      builtInProviders: [createTelegramConfig(fetchImpl)],
    });

    await distributor.dispatch({
      provider: "primary-dispatch",
      target: {
        kind: "dm",
        address: 77,
        topicId: 9001,
      },
      content: {
        type: "text",
        text: "hello",
      },
    });

    const body = await readJsonBody(calls[0]!);
    expect(body.direct_messages_topic_id).toBe(9001);
  });

  it("maps platform actions to Telegram inline keyboard buttons", async () => {
    const { fetchImpl, calls } = createFetchStub([
      { ok: true, result: { message_id: 104, chat: { id: 77 } } },
    ]);
    const distributor = createDistributor({
      builtInProviders: [createTelegramConfig(fetchImpl)],
    });

    await distributor.dispatch({
      provider: "primary-dispatch",
      target: {
        kind: "dm",
        address: 77,
      },
      content: {
        type: "text",
        text: "Approve bash?",
      },
      options: {
        actions: [[
          { id: "approval:a1:approve", label: "Approve", style: "primary" },
          { id: "approval:a1:deny", label: "Deny", style: "danger" },
        ]],
      },
    });

    const body = await readJsonBody(calls[0]!);
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[
        { text: "Approve", callback_data: "approval:a1:approve" },
        { text: "Deny", callback_data: "approval:a1:deny" },
      ]],
    });
  });

  it("dispatches media groups through sendMediaGroup", async () => {
    const { fetchImpl, calls } = createFetchStub([
      {
        ok: true,
        result: [
          { message_id: 201, chat: { id: -1005 } },
          { message_id: 202, chat: { id: -1005 } },
        ],
      },
    ]);
    const distributor = createDistributor({
      builtInProviders: [createTelegramConfig(fetchImpl)],
    });

    const result = await distributor.dispatch({
      provider: "primary-dispatch",
      target: {
        kind: "channel",
        address: "@gallery",
      },
      content: {
        type: "media-group",
        items: [
          {
            type: "photo",
            source: "https://example.com/1.png",
            caption: "**First**",
            format: "markdown",
          },
          {
            type: "video",
            source: "https://example.com/2.mp4",
          },
        ],
      },
    });

    expect(result.remoteMessageIds).toEqual(["201", "202"]);
    expect(calls[0]?.url.endsWith("/sendMediaGroup")).toBe(true);

    const body = await readJsonBody(calls[0]!);
    const media = body.media as Array<Record<string, unknown>>;
    expect(media).toHaveLength(2);
    expect(media[0]?.type).toBe("photo");
    expect(media[0]?.parse_mode).toBe("HTML");
    expect(String(media[0]?.caption)).toContain("<b>First</b>");
  });

  it("rejects native draft delivery mode", async () => {
    const { fetchImpl } = createFetchStub([]);
    const distributor = createDistributor({
      builtInProviders: [createTelegramConfig(fetchImpl)],
    });

    await expect(
      distributor.dispatch({
        provider: "primary-dispatch",
        target: {
          kind: "channel",
          address: "@mono_channel",
        },
        content: {
          type: "text",
          text: "hello",
        },
        options: {
          deliveryMode: "native-draft",
        },
      }),
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  it("rejects unsupported telegram target and media combinations", async () => {
    const { fetchImpl } = createFetchStub([]);
    const distributor = createDistributor({
      builtInProviders: [createTelegramConfig(fetchImpl)],
    });

    await expect(
      distributor.dispatch({
        provider: "primary-dispatch",
        target: {
          kind: "channel",
          address: "@mono_channel",
          topicId: 1,
        },
        content: {
          type: "text",
          text: "hello",
        },
      }),
    ).rejects.toBeInstanceOf(UnsupportedTargetError);

    await expect(
      distributor.dispatch({
        provider: "primary-dispatch",
        target: {
          kind: "channel",
          address: "@mono_channel",
        },
        content: {
          type: "media-group",
          items: [
            { type: "photo", source: "https://example.com/1.png" },
            { type: "document", source: "https://example.com/2.pdf" },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(UnsupportedContentError);
  });

  it("fails when the provider alias is not registered", async () => {
    const distributor = createDistributor();

    await expect(
      distributor.dispatch({
        provider: "missing-provider",
        target: {
          kind: "channel",
          address: "@mono_channel",
        },
        content: {
          type: "text",
          text: "hello",
        },
      }),
    ).rejects.toBeInstanceOf(ProviderNotFoundError);
  });

  it("normalizes Telegram photo updates into platform-agnostic task input", async () => {
    const { fetchImpl, calls } = createTelegramInboundFetchStub();
    const provider = createBuiltInProvider(createTelegramConfig(fetchImpl));
    const incoming = await provider.normalizeIncomingMessage?.({
      update_id: 1,
      message: {
        message_id: 10,
        text: "what is in this image?",
        chat: {
          id: 42,
          type: "private",
        },
        from: {
          id: 7,
          username: "alice",
          first_name: "Alice",
        },
        photo: [
          { file_id: "small" },
          { file_id: "large" },
        ],
      },
    });

    expect(incoming).not.toBeNull();
    expect(incoming?.platform).toBe("telegram");
    expect(incoming?.provider).toBe("primary-dispatch");
    expect(incoming?.sender).toEqual({
      id: "7",
      username: "alice",
      displayName: "Alice",
    });
    expect(incoming?.target).toEqual({
      kind: "dm",
      address: 42,
      topicId: undefined,
    });
    expect(incoming?.attachments).toHaveLength(1);
    expect(incoming?.attachments[0]).toMatchObject({
      kind: "image",
      mimeType: "image/jpeg",
      sourceLabel: "telegram-photo-10.jpg",
      origin: "remote_platform",
    });
    expect(inboundMessageToTaskInput(incoming!)).toEqual({
      text: "what is in this image?",
      attachments: incoming?.attachments,
    });
    expect(calls[0]?.url.endsWith("/getFile")).toBe(true);
    expect(calls[1]?.url).toContain("/file/botbot-token/photos/file_10.jpg");
  });

  it("normalizes Telegram callback queries into platform-agnostic actions", async () => {
    const { fetchImpl } = createTelegramInboundFetchStub();
    const provider = createBuiltInProvider(createTelegramConfig(fetchImpl));

    const action = await provider.normalizeIncomingAction?.({
      update_id: 3,
      callback_query: {
        id: "callback-1",
        data: "approval:a1:approve",
        from: {
          id: 7,
          username: "alice",
          first_name: "Alice",
        },
        message: {
          message_id: 25,
          chat: {
            id: 42,
            type: "private",
          },
        },
      },
    });

    expect(action).toEqual({
      provider: "primary-dispatch",
      platform: "telegram",
      interactionId: "callback-1",
      actionId: "approval:a1:approve",
      sender: {
        id: "7",
        username: "alice",
        displayName: "Alice",
      },
      target: {
        kind: "dm",
        address: 42,
        topicId: undefined,
      },
      remoteMessageId: "25",
      raw: expect.any(Object),
    });
  });

  it("ignores unsupported inbound Telegram media payloads", async () => {
    const { fetchImpl } = createTelegramInboundFetchStub();
    const provider = createBuiltInProvider(createTelegramConfig(fetchImpl));

    const incoming = await provider.normalizeIncomingMessage?.({
      update_id: 2,
      message: {
        message_id: 11,
        chat: {
          id: -1001,
          type: "channel",
        },
        sender_chat: {
          id: -1001,
          title: "mono",
        },
        document: {
          file_id: "doc",
          mime_type: "application/pdf",
        },
      },
    });

    expect(incoming).toBeNull();
  });
});
