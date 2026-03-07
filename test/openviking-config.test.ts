import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultMemoryConfig } from "../packages/config/src/defaults.js";
import { resolveMonoConfig } from "../packages/config/src/resolver.js";
import { writeJsonFile, type MonoGlobalConfig, type MonoProjectConfig } from "../packages/shared/src/index.js";

const tempPaths: string[] = [];
const originalMonoConfigDir = process.env.MONO_CONFIG_DIR;
const originalOpenVikingUrl = process.env.OPENVIKING_URL;
const originalOpenVikingAgentId = process.env.OPENVIKING_AGENT_ID;

afterEach(async () => {
  if (originalMonoConfigDir === undefined) {
    delete process.env.MONO_CONFIG_DIR;
  } else {
    process.env.MONO_CONFIG_DIR = originalMonoConfigDir;
  }

  if (originalOpenVikingUrl === undefined) {
    delete process.env.OPENVIKING_URL;
  } else {
    process.env.OPENVIKING_URL = originalOpenVikingUrl;
  }

  if (originalOpenVikingAgentId === undefined) {
    delete process.env.OPENVIKING_AGENT_ID;
  } else {
    process.env.OPENVIKING_AGENT_ID = originalOpenVikingAgentId;
  }

  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

describe("OpenViking memory config", () => {
  it("provides stable defaults for evaluation mode", () => {
    const config = createDefaultMemoryConfig();

    expect(config.retrievalBackend).toBe("local");
    expect(config.fallbackToLocalOnFailure).toBe(true);
    expect(config.openViking.enabled).toBe(false);
    expect(config.openViking.apiKeyEnv).toBe("OPENVIKING_API_KEY");
    expect(config.openViking.agentId).toBe("mono");
    expect(config.openViking.targetUri).toBe("viking://agent/memories/");
    expect(config.openViking.useSessionSearch).toBe(true);
    expect(config.openViking.shadowExport).toBe(false);
  });

  it("deep-merges OpenViking config across global, project, and env layers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-openviking-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-openviking-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;
    process.env.OPENVIKING_URL = "https://env.example";
    process.env.OPENVIKING_AGENT_ID = "env-agent";

    const globalConfig: MonoGlobalConfig = {
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
            providerFactory: "openai",
            apiKeyEnv: "OPENAI_API_KEY",
            supportsTools: true,
            supportsReasoning: true
          }
        },
        memory: {
          retrievalBackend: "openviking",
          fallbackToLocalOnFailure: false,
          openViking: {
            enabled: true,
            url: "https://global.example",
            targetUri: "viking://global/memories/",
            timeoutMs: 10_000,
            apiKeyEnv: "GLOBAL_OPENVIKING_KEY",
            agentId: "global-agent",
            useSessionSearch: true,
            shadowExport: true
          }
        }
      },
      projects: {}
    };
    const projectConfig: MonoProjectConfig = {
      profile: "default",
      memory: {
        fallbackToLocalOnFailure: true,
        openViking: {
          targetUri: "viking://project/memories/",
          useSessionSearch: false
        }
      }
    };

    await writeJsonFile(join(configDir, "config.json"), globalConfig);
    await writeJsonFile(join(cwd, ".mono", "config.json"), projectConfig);

    const resolved = await resolveMonoConfig({ cwd });

    expect(resolved.memory.retrievalBackend).toBe("openviking");
    expect(resolved.memory.fallbackToLocalOnFailure).toBe(true);
    expect(resolved.memory.openViking.enabled).toBe(true);
    expect(resolved.memory.openViking.url).toBe("https://env.example");
    expect(resolved.memory.openViking.agentId).toBe("env-agent");
    expect(resolved.memory.openViking.targetUri).toBe("viking://project/memories/");
    expect(resolved.memory.openViking.timeoutMs).toBe(10_000);
    expect(resolved.memory.openViking.apiKeyEnv).toBe("GLOBAL_OPENVIKING_KEY");
    expect(resolved.memory.openViking.useSessionSearch).toBe(false);
    expect(resolved.memory.openViking.shadowExport).toBe(true);
  });
});
