import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function createAgentConfig(rootDir: string): Promise<string> {
  const configDir = join(rootDir, ".mono");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({
      version: 1,
      mono: {
        defaultProfile: "default",
        profiles: {
          default: {
            provider: "openai",
            modelId: "gpt-4.1-mini",
            baseURL: "https://api.openai.com/v1",
            family: "openai-compatible",
            transport: "xsai-openai-compatible",
            supportsTools: true,
            supportsReasoning: true
          }
        }
      }
    }),
    "utf8"
  );
  return configDir;
}

describe("Agent", () => {
  it("aborts the active controller", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const controller = new AbortController();
    (agent as { activeRun?: { id: number; controller: AbortController } }).activeRun = {
      id: 1,
      controller
    };

    expect(agent.isRunning()).toBe(true);
    agent.abort();
    expect(controller.signal.aborted).toBe(true);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("blocks switching profile and session while a run is active", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    (agent as { activeRun?: { id: number; controller: AbortController } }).activeRun = {
      id: 1,
      controller: new AbortController()
    };

    await expect(agent.setProfile("default")).rejects.toThrow("Cannot switch profile while agent is running");
    await expect(agent.switchSession("other")).rejects.toThrow("Cannot switch session while agent is running");

    delete process.env.MONO_CONFIG_DIR;
  });
});
