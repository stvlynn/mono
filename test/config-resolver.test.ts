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
  it("defaults sensitive action mode to blacklist and resolves explicit overrides", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-resolver-settings-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-resolver-settings-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

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
            supportsReasoning: true
          }
        }
      },
      projects: {}
    } satisfies MonoGlobalConfig);

    const defaultResolved = await resolveMonoConfig({ cwd });
    expect(defaultResolved.settings.sensitiveActionMode).toBe("blacklist");

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
            supportsReasoning: true
          }
        },
        settings: {
          sensitiveActionMode: "strict"
        }
      },
      projects: {}
    } satisfies MonoGlobalConfig);

    const strictResolved = await resolveMonoConfig({ cwd });
    expect(strictResolved.settings.sensitiveActionMode).toBe("strict");
  });

  it("resolves default context settings and applies project overrides", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-resolver-context-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-resolver-context-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

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
            supportsReasoning: true
          }
        },
        context: {
          bootstrap: {
            totalMaxChars: 12_345
          }
        }
      },
      projects: {}
    } satisfies MonoGlobalConfig);

    await writeJsonFile(join(cwd, ".mono", "config.json"), {
      version: 1,
      mono: {
        context: {
          userTimezone: "UTC",
          docs: {
            entryPaths: ["docs/README.md", "docs/api"]
          }
        }
      }
    });

    const resolved = await resolveMonoConfig({ cwd });

    expect(resolved.context.enabled).toBe(true);
    expect(resolved.context.userTimezone).toBe("UTC");
    expect(resolved.context.bootstrap.totalMaxChars).toBe(12_345);
    expect(resolved.context.docs.entryPaths).toEqual(["docs/README.md", "docs/api"]);
    expect(resolved.context.bootstrap.files).toContain(".mono/CONTEXT.md");
  });

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
            transport: "openai-compatible",
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
    expect(resolved.model.provider).toBe("moonshotai");
    expect(resolved.source.profile).toBe("global-mono");
    expect(resolved.memory.v2.enabled).toBe(true);
    expect(resolved.memory.v2.primaryEntityId).toBe("primary-user");
  });

  it("self-heals saved profiles to the catalog-declared interface when no runtime interface is pinned", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-resolver-minimax-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-resolver-minimax-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeJsonFile(join(configDir, "cache", "models.dev.json"), {
      version: 1,
      fetchedAt: Date.now(),
      providers: {
        minimax: {
          id: "minimax",
          canonicalId: "minimax",
          name: "MiniMax",
          env: ["MINIMAX_API_KEY"],
          api: "https://api.minimax.io/anthropic/v1",
          npm: "@ai-sdk/anthropic",
          supported: true,
          models: {
            "MiniMax-M2.5-highspeed": {
              id: "MiniMax-M2.5-highspeed",
              name: "MiniMax-M2.5-highspeed",
              providerId: "minimax",
              canonicalProviderId: "minimax",
              api: "https://api.minimax.io/anthropic/v1",
              npm: "@ai-sdk/anthropic",
              toolCall: true,
              reasoning: true,
              temperature: true,
              attachment: false,
              supported: true
            }
          }
        }
      }
    });

    const config: MonoGlobalConfig = {
      version: 1,
      mono: {
        defaultProfile: "default",
        profiles: {
          default: {
            provider: "minimax",
            modelId: "MiniMax-M2.5-highspeed",
            baseURL: "https://api.minimax.io/anthropic/v1",
            family: "anthropic",
            transport: "xsai-openai-compatible" as never,
            providerFactory: "custom",
            apiKeyEnv: "MINIMAX_API_KEY",
            supportsTools: true,
            supportsReasoning: true
          }
        }
      },
      projects: {}
    };

    await writeJsonFile(join(configDir, "config.json"), config);

    const resolved = await resolveMonoConfig({ cwd });

    expect(resolved.model.family).toBe("anthropic");
    expect(resolved.model.runtimeProviderKey).toBe("minimax:anthropic");
    expect(resolved.model.baseURL).toBe("https://api.minimax.io/anthropic/v1");
  });

  it("preserves legacy custom base URLs for catalog-backed profiles without a runtime key", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-resolver-minimax-proxy-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-resolver-minimax-proxy-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeJsonFile(join(configDir, "cache", "models.dev.json"), {
      version: 1,
      fetchedAt: Date.now(),
      providers: {
        minimax: {
          id: "minimax",
          canonicalId: "minimax",
          name: "MiniMax",
          env: ["MINIMAX_API_KEY"],
          api: "https://api.minimax.io/anthropic/v1",
          npm: "@ai-sdk/anthropic",
          supported: true,
          models: {
            "MiniMax-M2.5-highspeed": {
              id: "MiniMax-M2.5-highspeed",
              name: "MiniMax-M2.5-highspeed",
              providerId: "minimax",
              canonicalProviderId: "minimax",
              api: "https://api.minimax.io/anthropic/v1",
              npm: "@ai-sdk/anthropic",
              toolCall: true,
              reasoning: true,
              temperature: true,
              attachment: false,
              supported: true
            }
          }
        }
      }
    });

    await writeJsonFile(join(configDir, "config.json"), {
      version: 1,
      mono: {
        defaultProfile: "default",
        profiles: {
          default: {
            provider: "minimax",
            modelId: "MiniMax-M2.5-highspeed",
            baseURL: "https://proxy.example/anthropic/v1",
            family: "anthropic",
            transport: "xsai-openai-compatible" as never,
            providerFactory: "custom",
            apiKeyEnv: "MINIMAX_API_KEY",
            supportsTools: true,
            supportsReasoning: true
          }
        }
      },
      projects: {}
    });

    const resolved = await resolveMonoConfig({ cwd });

    expect(resolved.model.runtimeProviderKey).toBe("minimax:anthropic");
    expect(resolved.model.baseURL).toBe("https://proxy.example/anthropic/v1");
  });

  it("allows explicit model selection to bypass an unsupported default profile", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-resolver-explicit-model-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-resolver-explicit-model-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    const config: MonoGlobalConfig = {
      version: 1,
      mono: {
        defaultProfile: "broken",
        profiles: {
          broken: {
            provider: "unsupported",
            modelId: "unsupported-model",
            baseURL: "https://unsupported.example/v1",
            family: "anthropic",
            transport: "xsai-unsupported" as never,
            providerFactory: "custom",
            apiKeyEnv: "UNSUPPORTED_API_KEY",
            supportsTools: true,
            supportsReasoning: true
          }
        }
      },
      projects: {}
    };

    await writeJsonFile(join(configDir, "config.json"), config);

    const resolved = await resolveMonoConfig({
      cwd,
      modelSelection: "openai/gpt-4.1-mini"
    });

    expect(resolved.profileName).toBe("openai/gpt-4.1-mini");
    expect(resolved.model.provider).toBe("openai");
    expect(resolved.model.modelId).toBe("gpt-4.1-mini");
  });
});
