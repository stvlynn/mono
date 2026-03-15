import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonFile, type MonoGlobalConfig } from "../packages/shared/src/index.js";
import { isTelegramPollingConflict } from "@mono/telegram-control";

const tempPaths: string[] = [];
const originalMonoConfigDir = process.env.MONO_CONFIG_DIR;

async function createTelegramRuntimeWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), `${prefix}-cwd-`));
  const configDir = await mkdtemp(join(tmpdir(), `${prefix}-config-`));
  tempPaths.push(cwd, configDir);
  process.env.MONO_CONFIG_DIR = configDir;
  return { cwd, configDir };
}

async function writeTelegramRuntimeConfig(configDir: string): Promise<void> {
  await writeJsonFile(join(configDir, "config.json"), {
    version: 1,
    mono: {
      defaultProfile: "default",
      profiles: {
        default: {
          provider: "openai",
          modelId: "gpt-4.1-mini",
          baseURL: "https://api.openai.com/v1",
          family: "openai-compatible",
          transport: "openai-compatible",
          providerFactory: "openai",
          apiKeyEnv: "OPENAI_API_KEY",
          supportsTools: true,
          supportsReasoning: true,
        },
      },
      channels: {
        telegram: {
          enabled: true,
          botToken: "123456:ABCDEFGHIJKLMNO",
          allowFrom: ["7001"],
          groupAllowFrom: [],
          groups: {},
          approval: {
            allowChats: ["7001"],
            commandDenylist: [],
          },
          dmPolicy: "allowlist",
          pollingTimeoutSeconds: 1,
        },
      },
    },
    projects: {},
  } satisfies MonoGlobalConfig);
}

afterEach(async () => {
  if (originalMonoConfigDir === undefined) {
    delete process.env.MONO_CONFIG_DIR;
  } else {
    process.env.MONO_CONFIG_DIR = originalMonoConfigDir;
  }

  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

describe("telegram runtime conflict detection", () => {
  it("detects Telegram getUpdates conflict errors", () => {
    const error = new Error("Conflict: terminated by other getUpdates request; make sure that only one bot instance is running");
    expect(isTelegramPollingConflict(error)).toBe(true);
  });

  it("ignores unrelated polling errors", () => {
    const error = new Error("fetch failed");
    expect(isTelegramPollingConflict(error)).toBe(false);
  });

  it("uses sendMessageDraft preview streaming during Telegram chat handoff", () => {
    const source = readFileSync("packages/telegram-control/src/runtime.ts", "utf8");

    expect(source).toContain("createTelegramDraftPreviewStream");
    expect(source).toContain('"sendMessageDraft"');
    expect(source).toContain("preview?.materialize(reply)");
  });

  it("sends Telegram approval buttons and resolves callback approvals", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-approval-buttons");
    await writeTelegramRuntimeConfig(configDir);

    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const updateQueue: unknown[][] = [];
    let nextUpdateId = 1;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = url.slice(url.lastIndexOf("/") + 1);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ method, body });

      if (method === "getMe") {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            id: 9001,
            username: "mono_bot",
            first_name: "mono",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "sendMessage") {
        const callbackData = ((body.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> })?.inline_keyboard?.[0]?.[0]?.callback_data) ?? "";
        updateQueue.push([
          {
            update_id: nextUpdateId++,
            callback_query: {
              id: "callback-1",
              data: callbackData,
              from: {
                id: 7001,
                username: "alice",
                first_name: "Alice",
              },
              message: {
                message_id: 501,
                chat: {
                  id: 7001,
                  type: "private",
                },
              },
            },
          },
        ]);

        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 501,
            chat: { id: 7001 },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "getUpdates") {
        if (updateQueue.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const result = updateQueue.shift() ?? [];
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "answerCallbackQuery" || method === "editMessageReplyMarkup") {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected method: ${method}`);
    };

    const { TelegramControlRuntime } = await import("../packages/telegram-control/src/runtime.js");
    const runtime = new TelegramControlRuntime({ cwd, fetchImpl });
    await runtime.start();

    const approved = await runtime.requestApproval({
      toolName: "bash",
      input: { command: "rm notes.txt" },
      cwd,
      sessionId: "session-1",
      channel: {
        platform: "telegram",
        kind: "dm",
        id: "7001",
      },
      reason: "Sensitive bash command requires confirmation",
    });

    expect(approved).toBe(true);
    const sendMessageCall = calls.find((call) => call.method === "sendMessage");
    const buttons = ((sendMessageCall?.body.reply_markup as {
      inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>;
    })?.inline_keyboard?.[0]) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.text).toBe("Approve");
    expect(buttons[1]?.text).toBe("Deny");
    expect(buttons[0]?.callback_data).toMatch(/^approval:[0-9a-f-]+:approve$/);
    expect(buttons[1]?.callback_data).toBe(
      String(buttons[0]?.callback_data).replace(/approve$/u, "deny"),
    );
    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    expect(calls.some((call) => call.method === "editMessageReplyMarkup")).toBe(true);

    await runtime.stop();
  });

  it("continues polling while Telegram chat handoff waits for approval", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-chat-approval");
    await writeTelegramRuntimeConfig(configDir);

    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    let deliveredInitialMessage = false;
    let deliveredCallback = false;
    let approvalCallbackData = "";
    let resolveFinalReply: (() => void) | undefined;
    const finalReplySent = new Promise<void>((resolve) => {
      resolveFinalReply = resolve;
    });

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = url.slice(url.lastIndexOf("/") + 1);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ method, body });

      if (method === "getMe") {
        return new Response(JSON.stringify({
          ok: true,
          result: { id: 9001, username: "mono_bot", first_name: "mono" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "getUpdates") {
        if (!deliveredInitialMessage) {
          deliveredInitialMessage = true;
          return new Response(JSON.stringify({
            ok: true,
            result: [{
              update_id: 1,
              message: {
                message_id: 11,
                chat: { id: 7001, type: "private" },
                from: { id: 7001, username: "alice", first_name: "Alice" },
                text: "please continue",
              },
            }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }

        if (approvalCallbackData && !deliveredCallback) {
          deliveredCallback = true;
          return new Response(JSON.stringify({
            ok: true,
            result: [{
              update_id: 2,
              callback_query: {
                id: "callback-2",
                data: approvalCallbackData,
                from: { id: 7001, username: "alice", first_name: "Alice" },
                message: {
                  message_id: 701,
                  chat: { id: 7001, type: "private" },
                },
              },
            }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "sendMessage") {
        const buttons = ((body.reply_markup as {
          inline_keyboard?: Array<Array<{ callback_data?: string }>>;
        })?.inline_keyboard?.[0]) ?? [];
        if (buttons.length > 0) {
          approvalCallbackData = String(buttons[0]?.callback_data ?? "");
          return new Response(JSON.stringify({
            ok: true,
            result: { message_id: 701, chat: { id: 7001 } },
          }), { status: 200, headers: { "content-type": "application/json" } });
        }

        if (body.text === "approved") {
          resolveFinalReply?.();
        }

        return new Response(JSON.stringify({
          ok: true,
          result: { message_id: 702, chat: { id: 7001 } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "answerCallbackQuery" || method === "editMessageReplyMarkup") {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected method: ${method}`);
    };

    const { TelegramControlRuntime } = await import("../packages/telegram-control/src/runtime.js");
    let runtime: InstanceType<typeof TelegramControlRuntime>;
    runtime = new TelegramControlRuntime({
      cwd,
      fetchImpl,
      onChatMessage: async (request) => {
        const approved = await runtime.requestApproval({
          toolName: "bash",
          input: { command: "rm notes.txt" },
          cwd,
          sessionId: "session-1",
          channel: {
            platform: "telegram",
            kind: "dm",
            id: request.message.chatId,
          },
          reason: "Sensitive bash command requires confirmation",
        });
        return approved ? "approved" : "denied";
      },
    });
    await runtime.start();

    await Promise.race([
      finalReplySent,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for final reply")), 1000)),
    ]);

    expect(calls.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    expect(calls.some((call) => call.method === "editMessageReplyMarkup")).toBe(true);

    await runtime.stop();
  });

  it("generates unique approval callback ids across runtime restarts", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-approval-ids");
    await writeTelegramRuntimeConfig(configDir);

    const callbackIds: string[] = [];
    let callbackSequence = 1;
    const updateQueue: unknown[][] = [];

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = url.slice(url.lastIndexOf("/") + 1);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};

      if (method === "getMe") {
        return new Response(JSON.stringify({
          ok: true,
          result: { id: 9001, username: "mono_bot", first_name: "mono" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "sendMessage") {
        const callbackData = String(((body.reply_markup as {
          inline_keyboard?: Array<Array<{ callback_data?: string }>>;
        })?.inline_keyboard?.[0]?.[0]?.callback_data) ?? "");
        callbackIds.push(callbackData);
        updateQueue.push([{
          update_id: callbackSequence,
          callback_query: {
            id: `callback-${callbackSequence}`,
            data: callbackData,
            from: { id: 7001, username: "alice", first_name: "Alice" },
            message: {
              message_id: 800 + callbackSequence,
              chat: { id: 7001, type: "private" },
            },
          },
        }]);
        callbackSequence += 1;
        return new Response(JSON.stringify({
          ok: true,
          result: { message_id: 800 + callbackSequence, chat: { id: 7001 } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (method === "getUpdates") {
        const result = updateQueue.shift() ?? [];
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "answerCallbackQuery" || method === "editMessageReplyMarkup") {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected method: ${method}`);
    };

    const { TelegramControlRuntime } = await import("../packages/telegram-control/src/runtime.js");
    const request = {
      toolName: "bash" as const,
      input: { command: "rm notes.txt" },
      cwd,
      sessionId: "session-1",
      channel: {
        platform: "telegram" as const,
        kind: "dm" as const,
        id: "7001",
      },
      reason: "Sensitive bash command requires confirmation",
    };

    const firstRuntime = new TelegramControlRuntime({ cwd, fetchImpl });
    await firstRuntime.start();
    await firstRuntime.requestApproval(request);
    await firstRuntime.stop();

    const secondRuntime = new TelegramControlRuntime({ cwd, fetchImpl });
    await secondRuntime.start();
    await secondRuntime.requestApproval(request);
    await secondRuntime.stop();

    expect(callbackIds).toHaveLength(2);
    expect(callbackIds[0]).not.toBe(callbackIds[1]);
  });
});
