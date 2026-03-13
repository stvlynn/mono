import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeJsonFile } from "../packages/shared/src/index.js";
import { refreshModelsCatalog, listCatalogProviders, resolveMonoConfig } from "../packages/config/src/index.js";
import { ModelRegistry } from "../packages/llm/src/index.js";

const tempPaths: string[] = [];
const originalMonoConfigDir = process.env.MONO_CONFIG_DIR;
const originalFetch = global.fetch;

afterEach(async () => {
  if (originalMonoConfigDir === undefined) {
    delete process.env.MONO_CONFIG_DIR;
  } else {
    process.env.MONO_CONFIG_DIR = originalMonoConfigDir;
  }

  global.fetch = originalFetch;
  vi.restoreAllMocks();
  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

describe("models catalog", () => {
  it("falls back to builtin providers when no cache is available", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-catalog-fallback-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-catalog-fallback-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    const providers = await listCatalogProviders(cwd);

    expect(providers.some((provider) => provider.id === "openai")).toBe(true);
  });

  it("refreshes models.dev metadata into the mono cache", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-catalog-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-catalog-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        moonshotai: {
          name: "Moonshot AI",
          env: ["MOONSHOT_API_KEY"],
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.moonshot.ai/v1",
          models: {
            "kimi-k2-turbo-preview": {
              name: "Kimi K2 Turbo Preview",
              tool_call: true,
              reasoning: true,
              temperature: true,
              limit: {
                context: 128000
              }
            }
          }
        }
      })
    } as Response);

    await refreshModelsCatalog(cwd);
    const providers = await listCatalogProviders(cwd);

    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("moonshotai");
    expect(providers[0].models["kimi-k2-turbo-preview"]?.contextWindow).toBe(128000);
  });

  it("uses cached catalog metadata when resolving a direct model selection", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-catalog-resolve-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-catalog-resolve-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeJsonFile(join(configDir, "cache", "models.dev.json"), {
      version: 1,
      fetchedAt: Date.now(),
      providers: {
        moonshotai: {
          id: "moonshotai",
          canonicalId: "moonshotai",
          name: "Moonshot AI",
          env: ["MOONSHOT_API_KEY"],
          api: "https://api.moonshot.ai/v1",
          npm: "@ai-sdk/openai-compatible",
          supported: true,
          models: {
            "kimi-k2-turbo-preview": {
              id: "kimi-k2-turbo-preview",
              name: "Kimi K2 Turbo Preview",
              providerId: "moonshotai",
              canonicalProviderId: "moonshotai",
              api: "https://api.moonshot.ai/v1",
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

    const resolved = await resolveMonoConfig({
      cwd,
      modelSelection: "moonshot/kimi-k2-turbo-preview"
    });

    expect(resolved.model.provider).toBe("moonshotai");
    expect(resolved.model.baseURL).toBe("https://api.moonshot.ai/v1");
    expect(resolved.model.apiKeyEnv).toBe("MOONSHOT_API_KEY");
  });

  it("loads cached catalog models into the registry", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-catalog-registry-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-catalog-registry-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeJsonFile(join(configDir, "cache", "models.dev.json"), {
      version: 1,
      fetchedAt: Date.now(),
      providers: {
        moonshotai: {
          id: "moonshotai",
          canonicalId: "moonshotai",
          name: "Moonshot AI",
          env: ["MOONSHOT_API_KEY"],
          api: "https://api.moonshot.ai/v1",
          npm: "@ai-sdk/openai-compatible",
          supported: true,
          models: {
            "kimi-k2-turbo-preview": {
              id: "kimi-k2-turbo-preview",
              name: "Kimi K2 Turbo Preview",
              providerId: "moonshotai",
              canonicalProviderId: "moonshotai",
              api: "https://api.moonshot.ai/v1",
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

    const registry = new ModelRegistry({ cwd });
    await registry.load();

    expect(registry.list().some((model) => model.provider === "moonshotai" && model.modelId === "kimi-k2-turbo-preview")).toBe(true);
  });

  it("uses the catalog-declared transport for providers with anthropic-compatible models", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-catalog-minimax-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-catalog-minimax-config-"));
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
          catalogTransport: "anthropic",
          supported: true,
          models: {
            "MiniMax-M2.5-highspeed": {
              id: "MiniMax-M2.5-highspeed",
              name: "MiniMax M2.5 Highspeed",
              providerId: "minimax",
              canonicalProviderId: "minimax",
              api: "https://api.minimax.io/anthropic/v1",
              npm: "@ai-sdk/anthropic",
              catalogTransport: "anthropic",
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

    const resolved = await resolveMonoConfig({
      cwd,
      modelSelection: "minimax/MiniMax-M2.5-highspeed"
    });

    expect(resolved.model.family).toBe("anthropic");
    expect(resolved.model.transport).toBe("anthropic");
    expect(resolved.model.runtimeProviderKey).toBe("minimax:anthropic");
    expect(resolved.model.baseURL).toBe("https://api.minimax.io/anthropic/v1");
  });

  it("filters unsupported catalog transports from provider listings", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-catalog-filter-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-catalog-filter-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeJsonFile(join(configDir, "cache", "models.dev.json"), {
      version: 1,
      fetchedAt: Date.now(),
      providers: {
        openai: {
          id: "openai",
          canonicalId: "openai",
          name: "OpenAI",
          env: ["OPENAI_API_KEY"],
          api: "https://api.openai.com/v1",
          npm: "@ai-sdk/openai",
          catalogTransport: "openai-compatible",
          supported: true,
          models: {
            "gpt-4.1-mini": {
              id: "gpt-4.1-mini",
              name: "gpt-4.1-mini",
              providerId: "openai",
              canonicalProviderId: "openai",
              api: "https://api.openai.com/v1",
              npm: "@ai-sdk/openai",
              catalogTransport: "openai-compatible",
              toolCall: true,
              reasoning: true,
              temperature: true,
              attachment: false,
              supported: true
            }
          }
        },
        unsupported: {
          id: "unsupported",
          canonicalId: "unsupported",
          name: "Unsupported",
          env: ["UNSUPPORTED_API_KEY"],
          api: "https://unsupported.example/v1",
          npm: "@ai-sdk/unsupported",
          supported: false,
          models: {
            "unsupported-1": {
              id: "unsupported-1",
              name: "unsupported-1",
              providerId: "unsupported",
              canonicalProviderId: "unsupported",
              api: "https://unsupported.example/v1",
              npm: "@ai-sdk/unsupported",
              toolCall: true,
              reasoning: true,
              temperature: true,
              attachment: false,
              supported: false
            }
          }
        }
      }
    });

    const providers = await listCatalogProviders(cwd);

    expect(providers.map((provider) => provider.id)).toEqual(["openai"]);
  });

  it("self-heals broken saved profile transport metadata from the catalog", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-catalog-profile-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-catalog-profile-config-"));
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
          catalogTransport: "anthropic",
          supported: true,
          models: {
            "MiniMax-M2.5-highspeed": {
              id: "MiniMax-M2.5-highspeed",
              name: "MiniMax M2.5 Highspeed",
              providerId: "minimax",
              canonicalProviderId: "minimax",
              api: "https://api.minimax.io/anthropic/v1",
              npm: "@ai-sdk/anthropic",
              catalogTransport: "anthropic",
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
            baseURL: "https://api.minimax.io/anthropic/v1",
            family: "openai-compatible",
            transport: "xsai-openai-compatible",
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

    expect(resolved.model.family).toBe("anthropic");
    expect(resolved.model.runtimeProviderKey).toBe("minimax:anthropic");
    expect(resolved.model.baseURL).toBe("https://api.minimax.io/anthropic/v1");
    expect(resolved.model.apiKeyEnv).toBe("MINIMAX_API_KEY");
  });

  it("fails fast for catalog-backed models that mono cannot route", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-catalog-unsupported-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-catalog-unsupported-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeJsonFile(join(configDir, "cache", "models.dev.json"), {
      version: 1,
      fetchedAt: Date.now(),
      providers: {
        google: {
          id: "google",
          canonicalId: "google",
          name: "Google",
          env: ["GEMINI_API_KEY"],
          api: "https://generativelanguage.googleapis.com/v1beta",
          npm: "@ai-sdk/unsupported",
          supported: false,
          models: {
            "gemini-2.5-pro": {
              id: "gemini-2.5-pro",
              name: "gemini-2.5-pro",
              providerId: "google",
              canonicalProviderId: "google",
              api: "https://generativelanguage.googleapis.com/v1beta",
              npm: "@ai-sdk/unsupported",
              toolCall: true,
              reasoning: true,
              temperature: true,
              attachment: false,
              supported: false
            }
          }
        }
      }
    });

    await expect(
      resolveMonoConfig({
        cwd,
        modelSelection: "google/gemini-2.5-pro"
      })
    ).rejects.toThrow(/cannot route/i);
  });
});
