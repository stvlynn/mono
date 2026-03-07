import { existsSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { Agent } from "@mono/agent-core";
import { MonoConfigStore, getMonoConfigSummary, listProfiles, resolveApiKeyEnv, resolveBaseURL, resolveMonoConfig } from "@mono/config";
import { ModelRegistry } from "@mono/llm";
import { renderMemoryContext } from "@mono/memory";
import type { MemoryRecord, MonoGlobalConfig, MonoProjectConfig, SessionEntry } from "@mono/shared";

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

function formatContextPreview(label: string, lines: string[]): string {
  if (lines.length === 0) {
    return `${label}: <none>`;
  }
  return [`${label}:`, ...lines.map((line) => `  ${line}`)].join("\n");
}

function requireOpenVikingConfig(agent: Agent): NonNullable<ReturnType<Agent["getResolvedConfig"]>["memory"]["openViking"]> {
  const config = agent.getResolvedConfig().memory.openViking;
  if (!config.enabled || !config.url) {
    throw new Error("OpenViking is not configured. Set mono.memory.openViking.enabled=true and mono.memory.openViking.url.");
  }
  return config;
}

function requireSeekDbConfig(agent: Agent): NonNullable<ReturnType<Agent["getResolvedConfig"]>["memory"]["seekDb"]> {
  const config = agent.getResolvedConfig().memory.seekDb;
  if (!config.enabled) {
    throw new Error("SeekDB is not configured. Set mono.memory.seekDb.enabled=true.");
  }
  if (config.mode === "mysql" && !config.database) {
    throw new Error("SeekDB MySQL mode requires mono.memory.seekDb.database to be configured.");
  }
  if (config.mode === "python-embedded" && !config.embeddedPath) {
    throw new Error("SeekDB python-embedded mode requires mono.memory.seekDb.embeddedPath to be configured.");
  }
  return config;
}

async function loadOpenVikingAdapter(): Promise<{
  OpenVikingRetrievalProvider: new (...args: any[]) => {
    recallForSession(options: { sessionId: string; messages?: unknown[]; query?: string }): Promise<{ items: unknown[]; contextBlock: string }>;
    health(): Promise<unknown>;
  };
  OpenVikingShadowExporter: new (...args: any[]) => {
    exportRecord(record: MemoryRecord): Promise<unknown>;
  };
}> {
  const distUrl = new URL("../../openviking-adapter/dist/index.js", import.meta.url);
  if (existsSync(fileURLToPath(distUrl))) {
    return import(distUrl.href);
  }

  const srcUrl = new URL("../../openviking-adapter/src/index.ts", import.meta.url);
  return import(srcUrl.href);
}

async function loadSeekDbAdapter(): Promise<{
  SeekDbExecutionMemoryBackend: new (...args: any[]) => {
    append(record: MemoryRecord): Promise<void>;
    count(): Promise<number>;
  };
  SeekDbRetrievalProvider: new (...args: any[]) => {
    recallForSession(options: { sessionId: string; messages?: unknown[]; query?: string }): Promise<{ items: unknown[]; contextBlock: string }>;
  };
  SeekDbSessionMirror: new (...args: any[]) => {
    countEntries(sessionId?: string): Promise<number>;
    mirrorSession(input: { sessionId: string; cwd: string; headId?: string; entries: unknown[] }): Promise<unknown>;
  };
}> {
  const distUrl = new URL("../../seekdb-adapter/dist/index.js", import.meta.url);
  if (existsSync(fileURLToPath(distUrl))) {
    return import(distUrl.href);
  }

  const srcUrl = new URL("../../seekdb-adapter/src/index.ts", import.meta.url);
  return import(srcUrl.href);
}

async function loadSessionModule(): Promise<{
  SessionManager: new (...args: any[]) => {
    initialize(model: ReturnType<Agent["getCurrentModel"]>): Promise<void>;
    getHeadId(): string | undefined;
    readEntries(): Promise<SessionEntry[]>;
  } & {
    listSessions?: never;
  };
} & {
  SessionManager: {
    listSessions(cwd: string): Promise<Array<{ sessionId: string; filePath: string; cwd: string }>>;
    rootDirFromSessionFile(filePath: string): string;
    new (options: {
      cwd: string;
      sessionId?: string;
      branchHeadId?: string;
      sessionsDir?: string;
    }): {
      initialize(model: ReturnType<Agent["getCurrentModel"]>): Promise<void>;
      getHeadId(): string | undefined;
      readEntries(): Promise<SessionEntry[]>;
    };
  };
}> {
  const distUrl = new URL("../../session/dist/index.js", import.meta.url);
  if (existsSync(fileURLToPath(distUrl))) {
    return import(distUrl.href) as Promise<any>;
  }

  const srcUrl = new URL("../../session/src/index.ts", import.meta.url);
  return import(srcUrl.href) as Promise<any>;
}

async function loadSessionEntriesForMirror(agent: Agent, sessionId?: string): Promise<{
  sessionId: string;
  cwd: string;
  headId?: string;
  entries: SessionEntry[];
}> {
  const { SessionManager } = await loadSessionModule();
  const targetSessionId = sessionId ?? agent.getSessionId();
  const sessions = await SessionManager.listSessions(process.cwd());
  const target = sessions.find((entry) => entry.sessionId === targetSessionId);
  if (!target) {
    throw new Error(`Session not found: ${targetSessionId}`);
  }

  const session = new SessionManager({
    cwd: target.cwd,
    sessionId: targetSessionId,
    branchHeadId: targetSessionId === agent.getSessionId() ? agent.getBranchHeadId() : undefined,
    sessionsDir: SessionManager.rootDirFromSessionFile(target.filePath)
  });
  await session.initialize(agent.getCurrentModel());
  return {
    sessionId: targetSessionId,
    cwd: target.cwd,
    headId: session.getHeadId(),
    entries: await session.readEntries()
  };
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
      output.write(`Retrieval backend: ${config.memory.retrievalBackend}\n`);
      output.write(`Fallback to local: ${config.memory.fallbackToLocalOnFailure}\n`);
      output.write(`Store path: ${agent.getMemoryStorePath()}\n`);
      output.write(`OpenViking: ${config.memory.openViking.enabled ? config.memory.openViking.url ?? "<missing url>" : "disabled"}\n`);
      output.write(
        `SeekDB: ${
          config.memory.seekDb.enabled
            ? `${config.memory.seekDb.mode} (${config.memory.seekDb.database ?? config.memory.seekDb.embeddedPath ?? "<missing target>"})`
            : "disabled"
        }\n`
      );
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

  memory
    .command("compare")
    .description("Compare local execution-memory recall with OpenViking retrieval")
    .argument("<query>", "query to evaluate against both systems")
    .option("--json", "output JSON")
    .action(async (query: string, options) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();

      const localPlan = await agent.recallMemory(query);
      const localRecords = (
        await Promise.all(localPlan.selectedIds.map((id) => agent.getMemoryRecord(id)))
      ).filter((record): record is MemoryRecord => record !== null);
      const localContextBlock = renderMemoryContext(localRecords, new Set(localPlan.compactedIds));

      const openViking = requireOpenVikingConfig(agent);
      const { OpenVikingRetrievalProvider } = await loadOpenVikingAdapter();
      const provider = new OpenVikingRetrievalProvider({
        config: openViking
      });
      const external = await provider.recallForSession({
        sessionId: agent.getSessionId(),
        messages: agent.getMessages(),
        query
      });

      const payload = {
        query,
        local: {
          selectedIds: localPlan.selectedIds,
          compactedIds: localPlan.compactedIds,
          rawPairIds: localPlan.rawPairIds,
          contextBlock: localContextBlock
        },
        openViking: {
          items: external.items,
          contextBlock: external.contextBlock
        }
      };

      if (options.json) {
        output.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      output.write(`Query: ${query}\n`);
      output.write(`Local selected: ${localPlan.selectedIds.length}\n`);
      output.write(`OpenViking selected: ${external.items.length}\n`);
      output.write(`${formatContextPreview("Local context", localContextBlock ? localContextBlock.split("\n") : [])}\n`);
      output.write(
        `${formatContextPreview(
          "OpenViking context",
          external.contextBlock ? external.contextBlock.split("\n") : []
        )}\n`
      );
    });

  memory
    .command("openviking-status")
    .description("Check OpenViking connectivity with the current memory config")
    .action(async () => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const openViking = requireOpenVikingConfig(agent);
      const { OpenVikingRetrievalProvider } = await loadOpenVikingAdapter();
      const provider = new OpenVikingRetrievalProvider({
        config: openViking
      });
      const health = await provider.health();
      output.write(`${JSON.stringify({ url: openViking.url, health }, null, 2)}\n`);
    });

  memory
    .command("export-openviking")
    .description("Shadow-export a local execution memory record into OpenViking via session extraction")
    .argument("[id]", "memory record id; defaults to the latest local memory record")
    .action(async (id?: string) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const openViking = requireOpenVikingConfig(agent);
      const { OpenVikingShadowExporter } = await loadOpenVikingAdapter();
      const exporter = new OpenVikingShadowExporter({
        config: openViking
      });
      const record = id ? await agent.getMemoryRecord(id) : (await agent.listMemories(1))[0] ?? null;
      if (!record) {
        throw new Error(id ? `Memory record not found: ${id}` : "No local memory records available to export");
      }
      const result = await exporter.exportRecord(record);
      output.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  memory
    .command("seekdb-status")
    .description("Check SeekDB connectivity and show execution-memory/session mirror stats")
    .action(async () => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const seekDb = requireSeekDbConfig(agent);
      const { SeekDbExecutionMemoryBackend, SeekDbSessionMirror } = await loadSeekDbAdapter();
      const backend = new SeekDbExecutionMemoryBackend({ config: seekDb });
      const sessionMirror = new SeekDbSessionMirror({ config: seekDb });
      const health = await Promise.all([
        backend.count().catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
        sessionMirror.countEntries().catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
      ]);

      output.write(
        `${JSON.stringify(
          {
            mode: seekDb.mode,
            enabled: seekDb.enabled,
            database: seekDb.database,
            embeddedPath: seekDb.embeddedPath,
            executionMemoryCount: health[0],
            mirroredSessionEntryCount: health[1]
          },
          null,
          2
        )}\n`
      );
    });

  memory
    .command("compare-seekdb")
    .description("Compare local execution-memory recall with SeekDB-backed retrieval")
    .argument("<query>", "query to evaluate against both systems")
    .option("--json", "output JSON")
    .action(async (query: string, options) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();

      const localPlan = await agent.recallMemory(query);
      const localRecords = (
        await Promise.all(localPlan.selectedIds.map((id) => agent.getMemoryRecord(id)))
      ).filter((record): record is MemoryRecord => record !== null);
      const localContextBlock = renderMemoryContext(localRecords, new Set(localPlan.compactedIds));

      const seekDb = requireSeekDbConfig(agent);
      const { SeekDbExecutionMemoryBackend, SeekDbRetrievalProvider, SeekDbSessionMirror } = await loadSeekDbAdapter();
      const backend = new SeekDbExecutionMemoryBackend({ config: seekDb });
      const sessionMirror = new SeekDbSessionMirror({ config: seekDb });
      const provider = new SeekDbRetrievalProvider({
        config: seekDb,
        backend,
        sessionMirror
      });
      const external = await provider.recallForSession({
        sessionId: agent.getSessionId(),
        messages: agent.getMessages(),
        query
      });

      const payload = {
        query,
        local: {
          selectedIds: localPlan.selectedIds,
          compactedIds: localPlan.compactedIds,
          rawPairIds: localPlan.rawPairIds,
          contextBlock: localContextBlock
        },
        seekDb: {
          items: external.items,
          contextBlock: external.contextBlock
        }
      };

      if (options.json) {
        output.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      output.write(`Query: ${query}\n`);
      output.write(`Local selected: ${localPlan.selectedIds.length}\n`);
      output.write(`SeekDB selected: ${external.items.length}\n`);
      output.write(`${formatContextPreview("Local context", localContextBlock ? localContextBlock.split("\n") : [])}\n`);
      output.write(`${formatContextPreview("SeekDB context", external.contextBlock ? external.contextBlock.split("\n") : [])}\n`);
    });

  memory
    .command("export-seekdb")
    .description("Export a local execution memory record into SeekDB execution memory storage")
    .argument("[id]", "memory record id; defaults to the latest local memory record")
    .action(async (id?: string) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const seekDb = requireSeekDbConfig(agent);
      const { SeekDbExecutionMemoryBackend } = await loadSeekDbAdapter();
      const backend = new SeekDbExecutionMemoryBackend({ config: seekDb });
      const record = id ? await agent.getMemoryRecord(id) : (await agent.listMemories(1))[0] ?? null;
      if (!record) {
        throw new Error(id ? `Memory record not found: ${id}` : "No local memory records available to export");
      }
      await backend.append(record);
      output.write(
        `${JSON.stringify(
          {
            recordId: record.id,
            mode: seekDb.mode,
            exported: true
          },
          null,
          2
        )}\n`
      );
    });

  memory
    .command("mirror-session-seekdb")
    .description("Mirror one local session JSONL stream into SeekDB for evaluation")
    .argument("[sessionId]", "session id; defaults to the current session")
    .action(async (sessionId?: string) => {
      const agent = new Agent({ cwd: process.cwd() });
      await agent.initialize();
      const seekDb = requireSeekDbConfig(agent);
      const { SeekDbSessionMirror } = await loadSeekDbAdapter();
      const sessionMirror = new SeekDbSessionMirror({ config: seekDb });
      const sessionInput = await loadSessionEntriesForMirror(agent, sessionId);
      const result = await sessionMirror.mirrorSession(sessionInput);
      output.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  await program.parseAsync(argv, { from: "user" });
}
