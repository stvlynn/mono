import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonFile } from "../packages/shared/src/index.js";
import { persistProjectProfileSelection } from "../packages/config/src/project-profile.js";

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

describe("project profile persistence", () => {
  it("preserves unrelated project settings and clears stale model overrides", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-project-profile-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-project-profile-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeJsonFile(join(cwd, ".mono", "config.json"), {
      version: 1,
      mono: {
        profile: "old-profile",
        provider: "openai",
        modelId: "gpt-4.1-mini",
        baseURL: "https://proxy.example/v1",
        apiKeyRef: "local:old-profile",
        apiKeyEnv: "OPENAI_API_KEY",
        memory: {
          enabled: false
        },
        context: {
          userTimezone: "UTC"
        }
      }
    });

    const next = await persistProjectProfileSelection("anthropic-dev", cwd);

    expect(next).toEqual({
      profile: "anthropic-dev",
      memory: {
        enabled: false
      },
      context: {
        userTimezone: "UTC"
      }
    });
  });

  it("creates a minimal project config when none exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-project-profile-empty-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-project-profile-empty-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    const next = await persistProjectProfileSelection("default", cwd);

    expect(next).toEqual({
      profile: "default"
    });
  });
});
