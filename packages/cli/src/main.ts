import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { Agent } from "@mono/agent-core";
import { MonoConfigStore, getMonoConfigSummary, listProfiles, resolveApiKeyEnv, resolveBaseURL, resolveMonoConfig } from "@mono/config";
import { ModelRegistry } from "@mono/llm";
import type { MemoryRecord, MonoGlobalConfig, MonoProjectConfig } from "@mono/shared";

async function promptApproval(): Promise<(reason: { toolName: string; reason: string; input: unknown }) => Promise<boolean>> {
  const rl = createInterface({ input, output });
  return async (request) => {
    const answer = await rl.question(
      `Approve ${request.toolName}? ${request.reason}\n${JSON.stringify(request.input, null, 2)}\n[y/N] `
    );
    return answer.trim().toLowerCase() === "y";
  };
}

async function runPrint(
  promptText: string,
  options: { model?: string; profile?: string; baseURL?: string; yes?: boolean; continueSession?: boolean }
): Promise<void> {
  const agent = new Agent({
    model: options.model,
    profile: options.profile,
    baseURL: options.baseURL,
    autoApprove: options.yes,
    continueSession: options.continueSession
  });
  if (!options.yes) {
    agent.setRequestApproval(await promptApproval());
  }
  agent.subscribe((event) => {
    if (event.type === "assistant-text-delta") {
      process.stdout.write(event.delta);
    } else if (event.type === "task-phase-change") {
      process.stderr.write(`\n[task] phase=${event.task.phase}\n`);
    } else if (event.type === "task-verify-result") {
      process.stderr.write(`\n[verify] ${event.passed ? "passed" : "failed"} ${event.reason}\n`);
    } else if (event.type === "session-compressed") {
      process.stderr.write(`\n[session] compressed ${event.result.replacedMessageCount} messages\n`);
    } else if (event.type === "tool-start") {
      process.stderr.write(`\n[tool:${event.toolName}] start\n`);
    } else if (event.type === "tool-end") {
      process.stderr.write(`\n[tool:${event.toolName}] ${event.isError ? "error" : "done"}\n`);
    } else if (event.type === "task-summary") {
      process.stderr.write(`\n[task] ${event.result.summary}\n`);
    }
  });
  await agent.runTask(promptText);
  process.stdout.write("\n");
}

async function readApiKeyFromStdin(): Promise<string> {
  let raw = "";
  for await (const chunk of input) {
    raw += chunk.toString();
  }
  const token = raw.trim();
  if (!token) {
    throw new Error("Expected API key on stdin, but input was empty");
  }
  return token;
}

async function promptForProfileDefaults(options: {
  profile?: string;
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKeyEnv?: string;
}): Promise<{ profile: string; provider: string; model: string; baseURL: string; apiKeyEnv?: string; apiKey?: string }> {
  const rl = createInterface({ input, output });
  try {
    const provider = (options.provider ?? (await rl.question("Provider [openai]: ")) ?? "openai").trim() || "openai";
    const profile = (options.profile ?? (await rl.question("Profile name [default]: ")) ?? "default").trim() || "default";
    const defaultModel = provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4.1-mini";
    const model = (options.model ?? (await rl.question(`Model id [${defaultModel}]: `)) ?? defaultModel).trim();
    const defaultBaseURL = resolveBaseURL(provider);
    const baseURL = (options.baseURL ?? (await rl.question(`Base URL [${defaultBaseURL}]: `)) ?? defaultBaseURL).trim();
    const useEnvAnswer = (await rl.question("Use an environment variable for the API key? [Y/n]: ")).trim().toLowerCase();
    const useEnv = useEnvAnswer === "" || useEnvAnswer === "y" || useEnvAnswer === "yes";
    const defaultApiKeyEnv = resolveApiKeyEnv(provider);
    const apiKeyEnv = useEnv
      ? (
          options.apiKeyEnv ??
          (await rl.question(`API key env var [${defaultApiKeyEnv ?? ""}]: `)) ??
          defaultApiKeyEnv ??
          undefined
        )?.trim() || undefined
      : undefined;
    const apiKey = !useEnv ? (await rl.question("API key: ")).trim() || undefined : undefined;
    return { profile, provider, model, baseURL, apiKeyEnv, apiKey };
  } finally {
    rl.close();
  }
}

async function upsertProfile(options: {
  profile: string;
  provider: string;
  model: string;
  baseURL: string;
  apiKeyEnv?: string;
  apiKey?: string;
  setDefault?: boolean;
  bindProject?: boolean;
}): Promise<void> {
  const store = new MonoConfigStore(process.cwd());
  const config = (await store.readGlobalConfig()) ?? await store.initGlobalConfig();
  config.mono.profiles[options.profile] = {
    provider: options.provider,
    modelId: options.model,
    baseURL: options.baseURL,
    family: options.provider === "anthropic" ? "anthropic" : options.provider === "gemini" ? "gemini" : "openai-compatible",
    transport: "xsai-openai-compatible",
    providerFactory: options.provider === "anthropic" ? "anthropic" : options.provider === "openrouter" ? "openrouter" : options.provider === "google" || options.provider === "gemini" ? "google" : options.provider === "openai" ? "openai" : "custom",
    apiKeyRef: options.apiKey ? `local:${options.profile}` : undefined,
    apiKeyEnv: options.apiKey ? undefined : options.apiKeyEnv,
    supportsTools: true,
    supportsReasoning: true
  };
  if (options.setDefault || !config.mono.defaultProfile) {
    config.mono.defaultProfile = options.profile;
  }
  await store.writeGlobalConfig(config);
  if (options.apiKey) {
    await store.setProfileSecret(options.profile, options.apiKey);
  }
  if (options.bindProject) {
    await store.writeProjectConfig({
      profile: options.profile,
      provider: options.provider,
      modelId: options.model,
      baseURL: options.baseURL,
      apiKeyEnv: options.apiKey ? undefined : options.apiKeyEnv,
      apiKeyRef: options.apiKey ? `local:${options.profile}` : undefined
    });
  }
}

function getPathValue(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, value);
}

function setPathValue(target: Record<string, unknown>, path: string, nextValue: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = target;
  for (const key of keys.slice(0, -1)) {
    const existing = current[key];
    if (!existing || typeof existing !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = nextValue;
}

function parseConfigValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatMemoryRecord(record: MemoryRecord): string {
  const compacted = record.compacted.slice(0, 3).map((line) => `    - ${line}`).join("\n");
  return [
    `${record.id}  ${new Date(record.createdAt).toLocaleString()}`,
    `  files: ${record.files.join(", ") || "<none>"}`,
    `  tools: ${record.tools.join(", ") || "<none>"}`,
    `  input: ${record.input}`,
    `  output: ${record.output}`,
    compacted ? `  compacted:\n${compacted}` : "  compacted: <none>"
  ].join("\n");
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("mono")
    .description("xsai-powered coding agent CLI")
    .argument("[prompt...]", "initial prompt")
    .option("-p, --print", "run once and exit")
    .option("-m, --model <model>", "provider/model or raw model id")
    .option("--profile <profile>", "configured profile name from ~/.mono/config.json")
    .option("--base-url <baseUrl>", "override provider base URL")
    .option("-y, --yes", "auto-approve protected tools")
    .option("-c, --continue", "load previous session from the current workspace")
    .action(async (promptParts: string[], options) => {
      const promptText = promptParts.join(" ").trim();
      if (options.print) {
        if (!promptText) {
          throw new Error("Print mode requires a prompt");
        }
        await runPrint(promptText, {
          model: options.model,
          profile: options.profile,
          baseURL: options.baseUrl,
          yes: options.yes,
          continueSession: options.continue
        });
        return;
      }

      const agent = new Agent({
        model: options.model,
        profile: options.profile,
        baseURL: options.baseUrl,
        autoApprove: options.yes,
        continueSession: options.continue
      });
      const { runInteractiveApp } = await import("@mono/tui");
      await runInteractiveApp({
        agent,
        initialPrompt: promptText || undefined
      });
    });

  const auth = program.command("auth").description("Manage model authentication and profiles");

  auth
    .command("login")
    .description("Create or update a mono profile in ~/.mono")
    .option("--profile <profile>", "profile name")
    .option("--provider <provider>", "provider id")
    .option("--model <model>", "model id")
    .option("--base-url <baseUrl>", "provider base URL")
    .option("--api-key-env <envVar>", "environment variable to read the API key from")
    .option("--with-api-key", "read the API key from stdin")
    .option("--default", "set this profile as the default")
    .option("--project", "bind the current project to this profile")
    .action(async (options) => {
      const values = options.withApiKey
        ? {
            profile: options.profile ?? "default",
            provider: options.provider ?? "openai",
            model: options.model ?? (options.provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4.1-mini"),
            baseURL: options.baseUrl ?? resolveBaseURL(options.provider ?? "openai"),
            apiKeyEnv: options.apiKeyEnv,
            apiKey: await readApiKeyFromStdin()
          }
        : await promptForProfileDefaults({
            profile: options.profile,
            provider: options.provider,
            model: options.model,
            baseURL: options.baseUrl,
            apiKeyEnv: options.apiKeyEnv
          });
      await upsertProfile({
        ...values,
        setDefault: options.default,
        bindProject: options.project
      });
      output.write(`Saved profile ${values.profile} to ~/.mono/config.json\n`);
    });

  auth
    .command("status")
    .description("Show resolved auth and profile status")
    .option("--json", "output JSON")
    .action(async (options) => {
      const summary = await getMonoConfigSummary(process.cwd());
      const resolved = await resolveMonoConfig({ cwd: process.cwd() });
      const profiles = await listProfiles(process.cwd());
      const payload = {
        summary,
        resolved,
        profiles: profiles.map((profile) => ({
          name: profile.name,
          provider: profile.profile.provider,
          modelId: profile.profile.modelId,
          baseURL: profile.profile.baseURL,
          apiKeyEnv: profile.profile.apiKeyEnv,
          apiKeyRef: profile.profile.apiKeyRef
        }))
      };
      if (options.json) {
        output.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }
      output.write(`Config dir: ${summary.configDir}\n`);
      output.write(`Default profile: ${summary.defaultProfile ?? "<none>"}\n`);
      output.write(`Resolved profile: ${resolved.profileName}\n`);
      output.write(`Resolved model: ${resolved.model.provider}/${resolved.model.modelId}\n`);
      output.write(`Base URL: ${resolved.model.baseURL}\n`);
      output.write(`API key source: ${resolved.source.apiKey}\n`);
      for (const profile of profiles) {
        output.write(`- ${profile.name}: ${profile.profile.provider}/${profile.profile.modelId} -> ${profile.profile.baseURL}\n`);
      }
    });

  auth
    .command("logout")
    .description("Remove secrets for a profile and optionally delete the profile")
    .argument("[profile]", "profile name", "default")
    .option("--remove-profile", "remove the profile from config.json too")
    .action(async (profile: string, options) => {
      const store = new MonoConfigStore(process.cwd());
      await store.deleteProfileSecret(profile);
      if (options.removeProfile) {
        const config = await store.readGlobalConfig();
        if (config?.mono.profiles[profile]) {
          delete config.mono.profiles[profile];
          if (config.mono.defaultProfile === profile) {
            config.mono.defaultProfile = Object.keys(config.mono.profiles)[0] ?? "default";
          }
          await store.writeGlobalConfig(config);
        }
      }
      output.write(`Removed secret for profile ${profile}\n`);
    });

  const config = program.command("config").description("Manage ~/.mono configuration");

  config
    .command("init")
    .description("Initialize ~/.mono directory structure")
    .action(async () => {
      const store = new MonoConfigStore(process.cwd());
      const globalConfig = await store.initGlobalConfig();
      output.write(`Initialized ${store.paths.globalDir}\n`);
      output.write(`Default profile: ${globalConfig.mono.defaultProfile}\n`);
    });

  config
    .command("migrate")
    .description("Migrate legacy configuration into ~/.mono")
    .option("--cleanup", "delete legacy files after a successful migration")
    .action(async (options) => {
      const store = new MonoConfigStore(process.cwd());
      const result = await store.migrateLegacy(Boolean(options.cleanup));
      output.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  config
    .command("get")
    .description("Get a value from ~/.mono/config.json")
    .argument("<key>", "dot path, e.g. mono.defaultProfile")
    .action(async (key: string) => {
      const store = new MonoConfigStore(process.cwd());
      const config = await store.readGlobalConfig();
      output.write(`${JSON.stringify(getPathValue(config, key), null, 2)}\n`);
    });

  config
    .command("list")
    .description("Print ~/.mono/config.json")
    .action(async () => {
      const store = new MonoConfigStore(process.cwd());
      const config = await store.readGlobalConfig();
      output.write(`${JSON.stringify(config, null, 2)}\n`);
    });

  config
    .command("set")
    .description("Set a non-secret value in ~/.mono/config.json")
    .argument("<key>", "dot path")
    .argument("<value>", "JSON or plain string value")
    .action(async (key: string, value: string) => {
      if (/apikey/i.test(key) || /secret/i.test(key)) {
        throw new Error("Use mono auth login to manage API keys and secrets");
      }
      const store = new MonoConfigStore(process.cwd());
      const config = (await store.readGlobalConfig()) ?? await store.initGlobalConfig();
      setPathValue(config as unknown as Record<string, unknown>, key, parseConfigValue(value));
      await store.writeGlobalConfig(config as MonoGlobalConfig);
      output.write(`Updated ${key}\n`);
    });

  config
    .command("bind-project")
    .description("Bind the current project to a profile")
    .argument("<profile>", "profile name")
    .action(async (profile: string) => {
      const store = new MonoConfigStore(process.cwd());
      const projectConfig: MonoProjectConfig = { profile };
      await store.writeProjectConfig(projectConfig);
      output.write(`Bound ${process.cwd()} to profile ${profile}\n`);
    });

  program
    .command("models")
    .description("List configured models")
    .action(async () => {
      const registry = new ModelRegistry({ cwd: process.cwd() });
      await registry.load();
      for (const model of registry.list()) {
        console.log(`${model.provider}/${model.modelId} -> ${model.baseURL}`);
      }
      const profiles = registry.listProfiles();
      if (profiles.length > 0) {
        console.log("profiles:");
        for (const profile of profiles) {
          console.log(`  ${profile.name} -> ${profile.model.provider}/${profile.model.modelId}`);
        }
      }
    });

  const memory = program.command("memory").description("Inspect and manage project memory");

  memory
    .command("status")
    .description("Show memory configuration and store status")
    .action(async () => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const count = await agent.countMemories();
      const records = await agent.listMemories(1);
      const config = agent.getResolvedConfig();
      output.write(`Enabled: ${config.memory.enabled}\n`);
      output.write(`Auto inject: ${config.memory.autoInject}\n`);
      output.write(`Store path: ${agent.getMemoryStorePath()}\n`);
      output.write(`Records: ${count}\n`);
      output.write(`Current session: ${agent.getSessionId()}\n`);
      output.write(`Last memory: ${records[0]?.id ?? "<none>"}\n`);
    });

  memory
    .command("list")
    .description("List recent memory records")
    .option("-n, --limit <limit>", "number of records to show", "10")
    .action(async (options) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const records = await agent.listMemories(Number(options.limit));
      if (records.length === 0) {
        output.write("No memory records found.\n");
        return;
      }
      for (const record of records) {
        output.write(`${formatMemoryRecord(record)}\n`);
      }
    });

  memory
    .command("search")
    .description("Search memory records by keyword")
    .argument("<query>", "keyword query")
    .action(async (query: string) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const matches = await agent.searchMemories(query);
      if (matches.length === 0) {
        output.write("No matching memory records.\n");
        return;
      }
      for (const match of matches) {
        output.write(`${match.id}\n`);
        for (const line of match.matchedLines) {
          output.write(`  [${line.line}] ${line.text}\n`);
        }
      }
    });

  memory
    .command("show")
    .description("Show one memory record")
    .argument("<id>", "memory id")
    .action(async (id: string) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const record = await agent.getMemoryRecord(id);
      if (!record) {
        throw new Error(`Memory record not found: ${id}`);
      }
      output.write(`${formatMemoryRecord(record)}\n`);
      if (record.referencedMemoryIds.length > 0) {
        output.write(`  referenced: ${record.referencedMemoryIds.join(", ")}\n`);
      }
    });

  memory
    .command("recall")
    .description("Preview memory recall for the current session")
    .argument("[query]", "optional keyword query")
    .action(async (query?: string) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const plan = await agent.recallMemory(query);
      output.write(`${JSON.stringify(plan, null, 2)}\n`);
      if (plan.selectedIds.length > 0) {
        const records = await Promise.all(plan.selectedIds.map((id) => agent.getMemoryRecord(id)));
        for (const record of records.filter((item): item is MemoryRecord => item !== null)) {
          output.write(`${formatMemoryRecord(record)}\n`);
        }
      }
    });

  await program.parseAsync(argv, { from: "user" });
}
