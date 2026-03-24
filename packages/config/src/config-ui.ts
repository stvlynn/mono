import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  CONFIG_UI_REDACTED_SENTINEL,
  type ConfigUiGlobalConfigSnapshot,
  type ConfigUiProfileSummary,
  type ConfigUiReloadSignal,
  type MonoGlobalConfig,
} from "@mono/shared";
import { readJsonFile, writeJsonFile } from "@mono/shared";
import { MonoConfigStore } from "./store.js";
import { materializeGlobalConfig, validateAndMaterializeGlobalConfig } from "./resolver.js";

const CONFIG_UI_SENSITIVE_PATHS = ["mono.channels.telegram.botToken"];

function looksLikeEnvVarName(value: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/u.test(value.trim());
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPathValue(target: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) {
      return undefined;
    }
    return current[segment];
  }, target);
}

function setPathValue(target: unknown, path: string, value: unknown): void {
  const segments = path.split(".");
  let current = target as Record<string, unknown>;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const existing = current[segment];
    if (!isPlainObject(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const leaf = segments.at(-1);
  if (!leaf) {
    return;
  }

  if (value === undefined) {
    delete current[leaf];
    return;
  }

  current[leaf] = value;
}

export function getConfigUiSensitivePaths(): string[] {
  return [...CONFIG_UI_SENSITIVE_PATHS];
}

function collectSensitivePaths(value: unknown, prefix = ""): string[] {
  if (!isPlainObject(value)) {
    return [];
  }

  const paths: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string" && entry.trim()) {
      if (CONFIG_UI_SENSITIVE_PATHS.includes(path)) {
        paths.push(path);
        continue;
      }

      if (path.endsWith(".apiKeyEnv") && !looksLikeEnvVarName(entry)) {
        paths.push(path);
        continue;
      }
    }

    if (isPlainObject(entry)) {
      paths.push(...collectSensitivePaths(entry, path));
    }
  }

  return paths;
}

export function hashConfigUiSnapshot(config: MonoGlobalConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function redactGlobalConfigForUi(config: MonoGlobalConfig): {
  config: MonoGlobalConfig;
  redactedPaths: string[];
} {
  const next = cloneJson(config);
  const redactedPaths = collectSensitivePaths(next);

  for (const path of redactedPaths) {
    const currentValue = getPathValue(next, path);
    if (typeof currentValue === "string" && currentValue.trim()) {
      setPathValue(next, path, CONFIG_UI_REDACTED_SENTINEL);
    }
  }

  return {
    config: next,
    redactedPaths,
  };
}

export function restoreRedactedGlobalConfig(
  candidate: MonoGlobalConfig,
  current: MonoGlobalConfig,
  redactedPaths: string[] = collectSensitivePaths(current)
): MonoGlobalConfig {
  const next = cloneJson(candidate);

  for (const path of redactedPaths) {
    if (getPathValue(next, path) === CONFIG_UI_REDACTED_SENTINEL) {
      setPathValue(next, path, getPathValue(current, path));
    }
  }

  return next;
}

export function applySensitiveConfigUpdates(
  config: MonoGlobalConfig,
  updates: Record<string, string | null> | undefined
): MonoGlobalConfig {
  if (!updates || Object.keys(updates).length === 0) {
    return cloneJson(config);
  }

  const next = cloneJson(config);
  for (const [path, value] of Object.entries(updates)) {
    if (!CONFIG_UI_SENSITIVE_PATHS.includes(path)) {
      continue;
    }
    setPathValue(next, path, value === null ? undefined : value);
  }
  return next;
}

export async function loadConfigUiGlobalSnapshot(cwd = process.cwd()): Promise<ConfigUiGlobalConfigSnapshot> {
  const store = new MonoConfigStore(cwd);
  const config = materializeGlobalConfig(await store.readGlobalConfig(), { cwd });
  const { config: redactedConfig, redactedPaths } = redactGlobalConfigForUi(config);

  return {
    config: redactedConfig,
    baseHash: hashConfigUiSnapshot(config),
    configPath: store.paths.globalConfigPath,
    redactedPaths,
  };
}

export async function readMaterializedGlobalConfig(cwd = process.cwd()): Promise<MonoGlobalConfig> {
  const store = new MonoConfigStore(cwd);
  return materializeGlobalConfig(await store.readGlobalConfig(), { cwd });
}

export async function writeValidatedGlobalConfig(
  config: MonoGlobalConfig,
  options: {
    cwd?: string;
    sensitiveUpdates?: Record<string, string | null>;
  } = {}
): Promise<MonoGlobalConfig> {
  const cwd = options.cwd ?? process.cwd();
  const store = new MonoConfigStore(cwd);
  const current = materializeGlobalConfig(await store.readGlobalConfig(), { cwd });
  const restored = restoreRedactedGlobalConfig(config, current);
  const withSensitiveUpdates = applySensitiveConfigUpdates(restored, options.sensitiveUpdates);
  const validated = await validateAndMaterializeGlobalConfig(withSensitiveUpdates, { cwd });
  await store.writeGlobalConfig(validated);
  return validated;
}

export async function listConfigUiProfiles(cwd = process.cwd()): Promise<ConfigUiProfileSummary[]> {
  const store = new MonoConfigStore(cwd);
  const config = materializeGlobalConfig(await store.readGlobalConfig(), { cwd });
  const secrets = (await store.readSecrets()) ?? { version: 1, profiles: {} };

  return Object.entries(config.mono.profiles)
    .map(([name, profile]) => ({
      name,
      profile,
      isDefault: config.mono.defaultProfile === name,
      hasSecret: Boolean(secrets.profiles[name]?.apiKey),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getConfigUiReloadSignalPath(cwd = process.cwd()): string {
  const store = new MonoConfigStore(cwd);
  return join(store.paths.globalStateDir, "config-ui", "reload.json");
}

export async function readConfigUiReloadSignal(cwd = process.cwd()): Promise<ConfigUiReloadSignal | undefined> {
  return readJsonFile<ConfigUiReloadSignal>(getConfigUiReloadSignalPath(cwd));
}

export async function writeConfigUiReloadSignal(
  cwd = process.cwd(),
  reason = "config-ui-save"
): Promise<ConfigUiReloadSignal> {
  const signal: ConfigUiReloadSignal = {
    version: randomUUID(),
    updatedAt: Date.now(),
    reason,
  };
  await writeJsonFile(getConfigUiReloadSignalPath(cwd), signal);
  return signal;
}
