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

  it("can deny interactive confirmations entirely via approval policy", () => {
    const policy = new DefaultPermissionPolicy({
      approvalPolicy: "never",
    });

    expect(policy.evaluate(createRequest())).toEqual({
      type: "deny",
      reason: "Approval policy is set to never",
    });
  });

  it("can auto-approve non-destructive confirmations via approval policy", () => {
    const policy = new DefaultPermissionPolicy({
      approvalPolicy: "auto-approve",
    });

    expect(policy.evaluate(createRequest())).toEqual({ type: "allow" });
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

  it("allows channel_action send and sticker on the current allowlisted chat", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
    });

    expect(policy.evaluate(createRequest({
      toolName: "channel_action",
      input: { channel: "telegram", action: "send", targetId: "123456" },
      channel: telegramDmChannel,
    }))).toEqual({ type: "allow" });

    expect(policy.evaluate(createRequest({
      toolName: "channel_action",
      input: { channel: "telegram", action: "sticker", targetId: "123456" },
      channel: telegramDmChannel,
    }))).toEqual({ type: "allow" });
  });

  it("asks before channel_action edit/delete or cross-target sends", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
    });

    expect(policy.evaluate(createRequest({
      toolName: "channel_action",
      input: { channel: "telegram", action: "edit", messageId: 12, targetId: "123456" },
      channel: telegramDmChannel,
    }))).toEqual({
      type: "ask",
      reason: "channel_action edit requires confirmation",
    });

    expect(policy.evaluate(createRequest({
      toolName: "channel_action",
      input: { channel: "telegram", action: "send", targetId: "999999" },
      channel: telegramDmChannel,
    }))).toEqual({
      type: "ask",
      reason: "channel_action targeting another conversation requires confirmation",
    });
  });

  it("allows channel_store list/search but asks for upsert", () => {
    const policy = new DefaultPermissionPolicy({
      allowlistedChannels: [telegramDmChannel],
    });

    expect(policy.evaluate(createRequest({
      toolName: "channel_store",
      input: { channel: "telegram", resource: "sticker_source", action: "list" },
      channel: telegramDmChannel,
    }))).toEqual({ type: "allow" });

    expect(policy.evaluate(createRequest({
      toolName: "channel_store",
      input: {
        channel: "telegram",
        resource: "sticker_source",
        action: "search",
        entry: { setName: "CatsPack", excludeFileId: "CAAC123" },
      },
      channel: telegramDmChannel,
    }))).toEqual({ type: "allow" });

    expect(policy.evaluate(createRequest({
      toolName: "channel_store",
      input: {
        channel: "telegram",
        resource: "sticker_source",
        action: "upsert",
        entry: { packId: "default", emoji: "🙂", fileId: "CAAC123" },
      },
      channel: telegramDmChannel,
    }))).toEqual({
      type: "ask",
      reason: "channel_store upsert requires confirmation",
    });
  });

  it("blocks write/edit tools in read-only sandbox mode", () => {
    const policy = new DefaultPermissionPolicy({
      sandboxMode: "read-only",
    });

    expect(policy.evaluate(createRequest())).toEqual({
      type: "deny",
      reason: "Sandbox mode read-only forbids bash",
    });

    expect(policy.evaluate(createRequest({
      toolName: "write",
      input: { path: "README.md", content: "hello" },
    }))).toEqual({
      type: "deny",
      reason: "Sandbox mode read-only forbids write",
    });

    expect(policy.evaluate(createRequest({
      toolName: "edit",
      input: { path: "README.md", oldText: "a", newText: "b" },
    }))).toEqual({
      type: "deny",
      reason: "Sandbox mode read-only forbids edit",
    });
  });

  it("rejects unsupported workspace-write sandbox mode", () => {
    expect(() => new DefaultPermissionPolicy({
      sandboxMode: "workspace-write",
    })).toThrow("Sandbox mode workspace-write is not implemented yet.");
  });
});
