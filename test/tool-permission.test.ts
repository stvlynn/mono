import { describe, expect, it } from "vitest";
import type { PermissionRequest, ToolExecutionChannel } from "../packages/shared/src/index.js";
import { DefaultPermissionPolicy } from "../packages/tools/src/permission.js";

const telegramDmChannel: ToolExecutionChannel = {
  platform: "telegram",
  kind: "dm",
  id: "123456",
};

function createRequest(overrides: Partial<PermissionRequest>): PermissionRequest {
  return {
    toolName: "bash",
    input: { command: "pwd" },
    cwd: "/repo",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("tool permission policy", () => {
  it("allows protected tools on allowlisted channels", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
    });

    expect(policy.evaluate(createRequest({ channel: telegramDmChannel }))).toEqual({ type: "allow" });
    expect(policy.evaluate(createRequest({
      toolName: "write",
      input: { path: "README.md", content: "hello" },
      channel: telegramDmChannel,
    }))).toEqual({ type: "allow" });
  });

  it("still denies destructive commands on allowlisted channels", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
    });

    expect(policy.evaluate(createRequest({
      input: { command: "rm -rf /tmp/demo" },
      channel: telegramDmChannel,
    }))).toEqual({
      type: "deny",
      reason: "Command matches destructive denylist",
    });
  });

  it("denies configured command patterns before allowlist bypass", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
      commandDenylist: ["pnpm publish"],
    });

    expect(policy.evaluate(createRequest({
      input: { command: "pnpm   publish --tag next" },
      channel: telegramDmChannel,
    }))).toEqual({
      type: "deny",
      reason: "Command matches configured denylist",
    });
  });

  it("keeps the default confirmation flow for non-allowlisted channels", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
    });

    expect(policy.evaluate(createRequest())).toEqual({
      type: "ask",
      reason: "bash commands require confirmation by default",
    });
  });

  it("asks for sensitive bash commands on allowlisted channels in blacklist mode", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
      sensitiveActionMode: "blacklist",
    });

    expect(policy.evaluate(createRequest({
      input: { command: "rm notes.txt" },
      channel: telegramDmChannel,
    }))).toEqual({
      type: "ask",
      reason: "Sensitive bash command requires confirmation",
    });

    expect(policy.evaluate(createRequest({
      input: { command: "pwd" },
      channel: telegramDmChannel,
    }))).toEqual({ type: "allow" });
  });

  it("asks for every bash command on allowlisted channels in strict mode", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
      sensitiveActionMode: "strict",
    });

    expect(policy.evaluate(createRequest({
      input: { command: "pwd" },
      channel: telegramDmChannel,
    }))).toEqual({
      type: "ask",
      reason: "Strict mode requires confirmation for every bash command",
    });
  });

  it("keeps allow-all mode as a pure bypass for allowlisted channels", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
      sensitiveActionMode: "allow_all",
    });

    expect(policy.evaluate(createRequest({
      input: { command: "mv draft.txt archive.txt" },
      channel: telegramDmChannel,
    }))).toEqual({ type: "allow" });
  });
});
