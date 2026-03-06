import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonFile, type MonoGlobalConfig } from "../packages/shared/src/index.js";
import { resolveMonoConfig } from "../packages/config/src/resolver.js";

const tempPaths: string[] = [];
const originalMonoConfigDir = process.env.MONO_CONFIG_DIR;

afterEach(async () => {
  if (originalMonoConfigDir === undefined) {
    delete process.env.MONO_CONFIG_DIR;
  } else {
    process.env.MONO_CONFIG_DIR = originalMonoConfigDir;
  }

  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

describe("config resolver", () => {
  it("prefers ~/.mono-compatible global config from MONO_CONFIG_DIR", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-resolver-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-config-dir-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    const config: MonoGlobalConfig = {
      version: 1,
      mono: {
        defaultProfile: "default",
        profiles: {
          default: {
            provider: "moonshot",
            modelId: "kimi-k2-turbo-preview",
            baseURL: "https://api.moonshot.cn/v1",
            family: "openai-compatible",
            transport: "xsai-openai-compatible",
            providerFactory: "custom",
            apiKeyEnv: "MOONSHOT_API_KEY",
            supportsTools: true,
            supportsReasoning: true
          }
        }
      },
      projects: {}
    };

    await writeJsonFile(join(configDir, "config.json"), config);

    const resolved = await resolveMonoConfig({ cwd });

    expect(resolved.profileName).toBe("default");
    expect(resolved.model.provider).toBe("moonshot");
    expect(resolved.source.profile).toBe("global-mono");
  });
});
