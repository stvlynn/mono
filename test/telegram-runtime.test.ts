import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readJsonFile, writeJsonFile, type MonoGlobalConfig } from "../packages/shared/src/index.js";
import {
  buildTelegramModelMenuResult,
  isTelegramPollingConflict,
  TELEGRAM_MODEL_PROFILE_NAME,
  TelegramModelConfigWizard,
} from "@mono/telegram-control";

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

  it("syncs Telegram menu commands and menu button on startup", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-command-menu");
    await writeTelegramRuntimeConfig(configDir);

    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];

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

      if (method === "setMyCommands" || method === "setChatMenuButton") {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "getUpdates") {
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected method: ${method}`);
    };

    const { TelegramControlRuntime } = await import("../packages/telegram-control/src/runtime.js");
    const runtime = new TelegramControlRuntime({ cwd, fetchImpl });
    await runtime.start();
    await runtime.stop();

    const setMyCommandsCall = calls.find((call) => call.method === "setMyCommands");
    expect(setMyCommandsCall?.body.commands).toEqual([
      { command: "help", description: "Show Telegram help" },
      { command: "model", description: "Open model menu" },
      { command: "cancel", description: "Cancel the current setup flow" },
    ]);

    const setChatMenuButtonCall = calls.find((call) => call.method === "setChatMenuButton");
    expect(setChatMenuButtonCall?.body.menu_button).toEqual({ type: "commands" });
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

      if (method === "setMyCommands" || method === "setChatMenuButton") {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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

      if (method === "setMyCommands" || method === "setChatMenuButton") {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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

      if (method === "setMyCommands" || method === "setChatMenuButton") {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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

  it("applies an existing configured profile through the Telegram profile picker", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-existing-profile-picker");
    await writeTelegramRuntimeConfig(configDir);

    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const updateQueue: unknown[][] = [[{
      update_id: 1,
      message: {
        message_id: 41,
        chat: { id: 7001, type: "private" },
        from: { id: 7001, username: "alice", first_name: "Alice" },
        text: "/model",
      },
    }]];
    let nextUpdateId = 2;
    let nextMessageId = 700;
    let appliedProfile: string | undefined;
    let resolveApplied: (() => void) | undefined;
    const applied = new Promise<void>((resolve) => {
      resolveApplied = resolve;
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

      if (method === "setMyCommands" || method === "setChatMenuButton") {
        return new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "getUpdates") {
        const result = updateQueue.shift() ?? [];
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "sendMessage") {
        const text = String(body.text ?? "");
        const firstButton = ((body.reply_markup as {
          inline_keyboard?: Array<Array<{ callback_data?: string }>>;
        })?.inline_keyboard?.[0]?.[0]?.callback_data) ?? "";

        if (text.includes("Choose an existing profile or configure the shared Telegram profile.")) {
          updateQueue.push([{
            update_id: nextUpdateId++,
            callback_query: {
              id: "callback-existing-start",
              data: String(firstButton),
              from: { id: 7001, username: "alice", first_name: "Alice" },
              message: { message_id: nextMessageId, chat: { id: 7001, type: "private" } },
            },
          }]);
        } else if (text.includes("Choose one of the existing configured profiles.")) {
          updateQueue.push([{
            update_id: nextUpdateId++,
            callback_query: {
              id: "callback-existing-select",
              data: String(firstButton),
              from: { id: 7001, username: "alice", first_name: "Alice" },
              message: { message_id: nextMessageId, chat: { id: 7001, type: "private" } },
            },
          }]);
        } else if (text.includes("Choose whether to enable this profile or remove it.")) {
          updateQueue.push([{
            update_id: nextUpdateId++,
            callback_query: {
              id: "callback-existing-apply",
              data: String(firstButton),
              from: { id: 7001, username: "alice", first_name: "Alice" },
              message: { message_id: nextMessageId, chat: { id: 7001, type: "private" } },
            },
          }]);
        }

        return new Response(JSON.stringify({
          ok: true,
          result: { message_id: nextMessageId++, chat: { id: 7001 } },
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
    const runtime = new TelegramControlRuntime({
      cwd,
      fetchImpl,
      listConfiguredProfiles: async () => [
        {
          name: "alpha",
          model: {
            provider: "openai",
            modelId: "gpt-4.1-mini",
            baseURL: "https://api.openai.com/v1",
          },
        },
        {
          name: "beta",
          model: {
            provider: "anthropic",
            modelId: "claude-sonnet-4-5",
            baseURL: "https://api.anthropic.com/v1",
          },
        },
      ],
      isAgentBusy: () => false,
      applyProfile: async (profileName) => {
        appliedProfile = profileName;
        resolveApplied?.();
      },
    });
    await runtime.start();

    await Promise.race([
      applied,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for existing profile apply")), 1500)),
    ]);

    expect(appliedProfile).toBe("alpha");
    expect(calls.some((call) => String(call.body.text ?? "").includes("Choose one of the existing configured profiles."))).toBe(true);
    expect(calls.some((call) => String(call.body.text ?? "").includes("Profile: alpha"))).toBe(true);
    expect(calls.some((call) => String(call.body.text ?? "").includes("Choose whether to enable this profile or remove it."))).toBe(true);

    await runtime.stop();
  });

  it("keeps Telegram model picker callback data within Telegram limits", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-callback-limit");
    await writeTelegramRuntimeConfig(configDir);

    const wizard = new TelegramModelConfigWizard({
      cwd,
      listConfiguredProfiles: async () => [
        {
          name: "alpha-very-long-profile-name-for-telegram-check",
          model: {
            provider: "openai",
            modelId: "gpt-4.1-mini",
            baseURL: "https://api.openai.com/v1",
          },
        },
      ],
    });

    const list = await wizard.startExisting({
      messageId: 1,
      chatId: "7001",
      chatType: "private",
      senderId: "7001",
    });
    const selectAction = String(list.actions?.[0]?.[0]?.id ?? "");
    expect(Buffer.byteLength(selectAction, "utf8")).toBeLessThanOrEqual(64);

    const review = await wizard.handleAction({
      actionId: selectAction,
      senderId: "7001",
      chatId: "7001",
    });
    const enableAction = String(review?.actions?.[0]?.[0]?.id ?? "");
    const removeAction = String(review?.actions?.[0]?.[1]?.id ?? "");
    expect(Buffer.byteLength(enableAction, "utf8")).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(removeAction, "utf8")).toBeLessThanOrEqual(64);
  });

  it("renders the Telegram model menu in Chinese when requested", () => {
    const menu = buildTelegramModelMenuResult("zh");

    expect(menu.title).toBe("Telegram 模型菜单");
    expect(menu.lines.join("\n")).toContain("请选择已有 profile");
    expect(menu.actions?.[0]?.[0]?.label).toBe("选择已有 Profile");
    expect(menu.actions?.[0]?.[1]?.label).toBe("配置共享 Profile");
    expect(menu.actions?.[1]?.[0]?.label).toBe("中文");
    expect(menu.actions?.[1]?.[1]?.label).toBe("English");
  });

  it("preserves saved Telegram language preferences across session writes", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-language-persist");
    await writeTelegramRuntimeConfig(configDir);

    const wizard = new TelegramModelConfigWizard({
      cwd,
      listConfiguredProfiles: async () => [
        {
          name: "alpha",
          model: {
            provider: "openai",
            modelId: "gpt-4.1-mini",
            baseURL: "https://api.openai.com/v1",
          },
        },
      ],
    });

    const menu = buildTelegramModelMenuResult();
    const setZhAction = String(menu.actions?.[1]?.[0]?.id ?? "");
    const zhMenu = await wizard.handleAction({
      actionId: setZhAction,
      senderId: "7001",
      chatId: "7001",
    });
    expect(zhMenu?.title).toBe("Telegram 模型菜单");

    const startExistingAction = String(zhMenu?.actions?.[0]?.[0]?.id ?? "");
    const list = await wizard.handleAction({
      actionId: startExistingAction,
      senderId: "7001",
      chatId: "7001",
    });
    expect(list?.title).toBe("选择已有 Profile");

    const store = await readJsonFile<{ preferences?: Array<{ senderId: string; language: string }> }>(join(configDir, "state", "telegram", "model-config.json"));
    expect(store?.preferences).toEqual([{ senderId: "7001", language: "zh" }]);
  });

  it("removes an existing configured profile through the Telegram profile picker submenu", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-existing-profile-remove");
    await writeTelegramRuntimeConfig(configDir);
    const config = await readJsonFile<MonoGlobalConfig>(join(configDir, "config.json"));
    config!.mono.profiles.alpha = {
      provider: "openai",
      modelId: "gpt-4.1-mini",
      baseURL: "https://api.openai.com/v1",
      family: "openai-compatible",
      transport: "openai-compatible",
      providerFactory: "openai",
      apiKeyRef: "local:alpha",
      supportsTools: true,
      supportsReasoning: true,
    };
    await writeJsonFile(join(configDir, "config.json"), config);
    await writeJsonFile(join(configDir, "local", "secrets.json"), {
      version: 1,
      profiles: {
        alpha: { apiKey: "alpha-secret" },
      },
    });

    const wizard = new TelegramModelConfigWizard({
      cwd,
      listConfiguredProfiles: async () => [
        {
          name: "alpha",
          model: {
            provider: "openai",
            modelId: "gpt-4.1-mini",
            baseURL: "https://api.openai.com/v1",
          },
        },
      ],
    });

    const menu = buildTelegramModelMenuResult();
    const startExistingAction = String(menu.actions?.[0]?.[0]?.id ?? "");
    const list = await wizard.handleAction({
      actionId: startExistingAction,
      senderId: "7001",
      chatId: "7001",
    });
    const selectAction = String(list?.actions?.[0]?.[0]?.id ?? "");
    const review = await wizard.handleAction({
      actionId: selectAction,
      senderId: "7001",
      chatId: "7001",
    });
    const removeAction = String(review?.actions?.[0]?.[1]?.id ?? "");
    const removed = await wizard.handleAction({
      actionId: removeAction,
      senderId: "7001",
      chatId: "7001",
    });

    expect(removed?.removedProfileName).toBe("alpha");

    const nextConfig = await readJsonFile<MonoGlobalConfig>(join(configDir, "config.json"));
    expect(nextConfig?.mono.profiles.alpha).toBeUndefined();
    expect(nextConfig?.mono.defaultProfile).toBe("default");

    const secrets = await readJsonFile<{ profiles?: Record<string, { apiKey?: string }> }>(join(configDir, "local", "secrets.json"));
    expect(secrets?.profiles?.alpha).toBeUndefined();
  });

  it("does not point defaultProfile at a nonexistent default when removing the last profile", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-remove-last-profile");
    process.env.MONO_CONFIG_DIR = configDir;
    await writeJsonFile(join(configDir, "config.json"), {
      version: 1,
      mono: {
        defaultProfile: "alpha",
        profiles: {
          alpha: {
            provider: "openai",
            modelId: "gpt-4.1-mini",
            baseURL: "https://api.openai.com/v1",
            family: "openai-compatible",
            transport: "openai-compatible",
            providerFactory: "openai",
            apiKeyRef: "local:alpha",
            supportsTools: true,
            supportsReasoning: true
          }
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
              commandDenylist: []
            },
            dmPolicy: "allowlist",
            pollingTimeoutSeconds: 1
          }
        }
      },
      projects: {}
    } satisfies MonoGlobalConfig);

    const wizard = new TelegramModelConfigWizard({
      cwd,
      listConfiguredProfiles: async () => [
        {
          name: "alpha",
          model: {
            provider: "openai",
            modelId: "gpt-4.1-mini",
            baseURL: "https://api.openai.com/v1",
          },
        },
      ],
    });

    const menu = buildTelegramModelMenuResult();
    const startExistingAction = String(menu.actions?.[0]?.[0]?.id ?? "");
    const list = await wizard.handleAction({
      actionId: startExistingAction,
      senderId: "7001",
      chatId: "7001",
    });
    const selectAction = String(list?.actions?.[0]?.[0]?.id ?? "");
    const review = await wizard.handleAction({
      actionId: selectAction,
      senderId: "7001",
      chatId: "7001",
    });
    const removeAction = String(review?.actions?.[0]?.[1]?.id ?? "");
    await wizard.handleAction({
      actionId: removeAction,
      senderId: "7001",
      chatId: "7001",
    });

    const nextConfig = await readJsonFile<MonoGlobalConfig>(join(configDir, "config.json"));
    expect(nextConfig?.mono.profiles.alpha).toBeUndefined();
    expect(nextConfig?.mono.defaultProfile).toBe("");
  });

  it("saves the shared Telegram model profile through the model wizard", async () => {
    const { cwd, configDir } = await createTelegramRuntimeWorkspace("mono-telegram-model-wizard");
    await writeTelegramRuntimeConfig(configDir);

    const wizard = new TelegramModelConfigWizard({ cwd });

    const menu = buildTelegramModelMenuResult();
    const startSharedAction = String(menu.actions?.[0]?.[1]?.id ?? "");
    const chooseFamily = await wizard.handleAction({
      actionId: startSharedAction,
      senderId: "7001",
      chatId: "7001",
    });
    const chooseFamilyAction = String(chooseFamily?.actions?.[0]?.[0]?.id ?? "");
    const chooseBaseUrl = await wizard.handleAction({
      actionId: chooseFamilyAction,
      senderId: "7001",
      chatId: "7001",
    });
    const chooseBaseUrlAction = String(chooseBaseUrl?.actions?.[0]?.[0]?.id ?? "");
    const chooseModel = await wizard.handleAction({
      actionId: chooseBaseUrlAction,
      senderId: "7001",
      chatId: "7001",
    });
    const chooseModelAction = String(chooseModel?.actions?.[0]?.[0]?.id ?? "");
    const confirmApiKey = await wizard.handleAction({
      actionId: chooseModelAction,
      senderId: "7001",
      chatId: "7001",
    });
    const awaitApiKeyAction = String(confirmApiKey?.actions?.[0]?.[0]?.id ?? "");
    const awaitApiKey = await wizard.handleAction({
      actionId: awaitApiKeyAction,
      senderId: "7001",
      chatId: "7001",
    });
    expect(awaitApiKey?.status).toBe("Waiting for Telegram API key input");

    const review = await wizard.handleText({
      messageId: 77,
      chatId: "7001",
      chatType: "private",
      senderId: "7001",
      text: "sk-telegram-secret",
    });
    const saveAction = String(review?.actions?.[0]?.[0]?.id ?? "");
    const saved = await wizard.handleAction({
      actionId: saveAction,
      senderId: "7001",
      chatId: "7001",
    });

    expect(saved?.configuredProfileName).toBe(TELEGRAM_MODEL_PROFILE_NAME);
    expect(saved?.deleteSourceMessageId).toBe(77);

    const config = await readJsonFile<MonoGlobalConfig>(join(configDir, "config.json"));
    expect(config?.mono.defaultProfile).toBe(TELEGRAM_MODEL_PROFILE_NAME);
    expect(config?.mono.profiles[TELEGRAM_MODEL_PROFILE_NAME]).toMatchObject({
      provider: "openai",
      modelId: "gpt-4.1-mini",
      baseURL: "https://api.openai.com/v1",
      family: "openai-compatible",
      transport: "openai-compatible",
      providerFactory: "openai",
      apiKeyRef: `local:${TELEGRAM_MODEL_PROFILE_NAME}`,
    });

    const secrets = await readJsonFile<{ profiles?: Record<string, { apiKey?: string }> }>(join(configDir, "local", "secrets.json"));
    expect(secrets?.profiles?.[TELEGRAM_MODEL_PROFILE_NAME]?.apiKey).toBe("sk-telegram-secret");
  });
});
