import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultTelegramConfig, MonoConfigStore, resolveMonoConfig } from "@mono/config";
import { writeJsonFile, type MonoGlobalConfig } from "@mono/shared";
import {
  approveTelegramPairingCode,
  allowTelegramUserId,
  buildTelegramStatusResult,
  executePairCommand,
  executeTelegramCommand,
  listTelegramPairingRequests,
  processTelegramIncomingMessage,
  readTelegramAllowFromStore,
  upsertTelegramPairingRequest,
} from "@mono/telegram-control";

const tempPaths: string[] = [];
const originalMonoConfigDir = process.env.MONO_CONFIG_DIR;

afterEach(async () => {
  if (originalMonoConfigDir === undefined) {
    delete process.env.MONO_CONFIG_DIR;
  } else {
    process.env.MONO_CONFIG_DIR = originalMonoConfigDir;
  }

  await Promise.all(
    tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createTempWorkspace(prefix: string) {
  const cwd = await mkdtemp(join(tmpdir(), `${prefix}-cwd-`));
  const configDir = await mkdtemp(join(tmpdir(), `${prefix}-config-`));
  tempPaths.push(cwd, configDir);
  process.env.MONO_CONFIG_DIR = configDir;
  return { cwd, configDir };
}

describe("telegram control", () => {
  it("resolves default telegram channels config", async () => {
    const { cwd } = await createTempWorkspace("mono-telegram-defaults");
    const store = new MonoConfigStore(cwd);
    await store.initGlobalConfig();

    const resolved = await resolveMonoConfig({ cwd });

    expect(resolved.channels.telegram.enabled).toBe(false);
    expect(resolved.channels.telegram.dmPolicy).toBe("pairing");
    expect(resolved.channels.telegram.allowFrom).toEqual([]);
    expect(resolved.channels.telegram.groups).toEqual({});
  });

  it("rejects allowlist mode without a configured allowFrom entry", async () => {
    const { cwd, configDir } = await createTempWorkspace("mono-telegram-validation");

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
            dmPolicy: "allowlist",
            allowFrom: [],
          },
        },
      },
      projects: {},
    } satisfies MonoGlobalConfig);

    await expect(resolveMonoConfig({ cwd })).rejects.toThrow(
      "Telegram dmPolicy=allowlist requires at least one mono.channels.telegram.allowFrom entry",
    );
  });

  it("persists pairing requests and approvals in the Telegram store", async () => {
    const { cwd } = await createTempWorkspace("mono-telegram-pairing");

    const first = await upsertTelegramPairingRequest(
      { senderId: "123456789", username: "alice" },
      cwd,
    );
    const second = await upsertTelegramPairingRequest(
      { senderId: "123456789", username: "alice" },
      cwd,
    );

    expect(first.created).toBe(true);
    expect(first.code).toHaveLength(8);
    expect(second.created).toBe(false);
    expect(second.code).toBe(first.code);
    expect(await listTelegramPairingRequests(cwd)).toHaveLength(1);

    const approved = await approveTelegramPairingCode(first.code, cwd);

    expect(approved?.senderId).toBe("123456789");
    expect(await listTelegramPairingRequests(cwd)).toHaveLength(0);
    expect(await readTelegramAllowFromStore(cwd)).toEqual(["123456789"]);
  });

  it("executes pair commands for userid and botid", async () => {
    const { cwd } = await createTempWorkspace("mono-telegram-pair-command");

    const allowUserResult = await executePairCommand("telegram userid 222333444", cwd);
    const setBotIdResult = await executePairCommand("telegram botid 555666777", cwd);
    const statusResult = await buildTelegramStatusResult(cwd);

    expect(allowUserResult.ok).toBe(true);
    expect(setBotIdResult.ok).toBe(true);
    expect(statusResult.lines.join("\n")).toContain("Configured bot id: 555666777");
    expect(await readTelegramAllowFromStore(cwd)).toEqual(["222333444"]);
  });

  it("saves the telegram token through the command helper", async () => {
    const { cwd } = await createTempWorkspace("mono-telegram-token");

    const result = await executeTelegramCommand("token 123456:ABCDEFGHIJKLMNO", cwd);
    const resolved = await resolveMonoConfig({ cwd });

    expect(result.ok).toBe(true);
    expect(resolved.channels.telegram.enabled).toBe(true);
    expect(resolved.channels.telegram.botToken).toBe("123456:ABCDEFGHIJKLMNO");
  });

  it("issues pairing codes to unknown senders and accepts pair commands from authorized senders", async () => {
    const { cwd } = await createTempWorkspace("mono-telegram-inbound");

    const config = createDefaultTelegramConfig();

    const pendingResult = await processTelegramIncomingMessage({
      cwd,
      config,
      botIdentity: { id: "9001", username: "mono_bot", displayName: "mono" },
      message: {
        messageId: 1,
        chatId: "7001",
        chatType: "private",
        senderId: "7001",
        username: "new_user",
        displayName: "New User",
        text: "hello",
      },
    });

    expect(pendingResult?.ok).toBe(true);
    expect(pendingResult?.lines.join("\n")).toContain("Pairing code:");

    await allowTelegramUserId("1111", cwd);

    const pairResult = await processTelegramIncomingMessage({
      cwd,
      config,
      botIdentity: { id: "9001", username: "mono_bot", displayName: "mono" },
      message: {
        messageId: 2,
        chatId: "1111",
        chatType: "private",
        senderId: "1111",
        username: "owner",
        displayName: "Owner",
        text: "/pair telegram userid 9999",
      },
    });

    const helpResult = await processTelegramIncomingMessage({
      cwd,
      config,
      botIdentity: { id: "9001", username: "mono_bot", displayName: "mono" },
      message: {
        messageId: 3,
        chatId: "1111",
        chatType: "private",
        senderId: "1111",
        username: "owner",
        displayName: "Owner",
        text: "/help",
      },
    });

    expect(pairResult?.ok).toBe(true);
    expect(pairResult?.lines.join("\n")).toContain("Allowlisted Telegram user 9999");
    expect(helpResult?.lines.join("\n")).toContain("/pair telegram code <CODE>");
    expect(await readTelegramAllowFromStore(cwd)).toEqual(["1111", "9999"]);
  });
});
