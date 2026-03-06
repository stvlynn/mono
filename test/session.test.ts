import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../packages/session/src/index.js";
import type { UnifiedModel } from "../packages/shared/src/index.js";

const model: UnifiedModel = {
  provider: "openai",
  modelId: "gpt-4.1-mini",
  family: "openai-compatible",
  baseURL: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  supportsTools: true,
  supportsReasoning: true
};

describe("session manager", () => {
  it("writes and reloads conversation messages", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-a" });
    await manager.initialize(model);
    await manager.appendMessage({
      role: "user",
      content: "hello",
      timestamp: Date.now()
    });
    await manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "world" }],
      provider: "openai",
      model: "gpt-4.1-mini",
      stopReason: "stop",
      timestamp: Date.now()
    });

    const messages = await manager.loadMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("lists the latest session for a workspace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const first = new SessionManager({ cwd, sessionsDir, sessionId: "first" });
    await first.initialize(model);
    await first.appendMessage({
      role: "user",
      content: "one",
      timestamp: Date.now()
    });

    const second = new SessionManager({ cwd, sessionsDir, sessionId: "second" });
    await second.initialize(model);
    await second.appendMessage({
      role: "user",
      content: "two",
      timestamp: Date.now() + 1
    });

    const latest = await SessionManager.latestForCwd(cwd, sessionsDir);
    expect(latest?.sessionId).toBe("second");
  });
});
