import { access, cp, mkdir, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import {
  readJsonFile,
  writeJsonFile,
  type MonoGlobalConfig,
  type MonoProjectConfig,
  type MonoSecretsConfig,
  type UnifiedModel
} from "@mono/shared";
import { createDefaultGlobalConfig, modelToProfile } from "./defaults.js";
import { getMonoConfigPaths, type MonoConfigPaths } from "./paths.js";

interface LegacyModelsFile {
  models?: UnifiedModel[];
}

export interface MigrationResult {
  migratedProfiles: string[];
  migratedProjectConfig: boolean;
  migratedSessions: boolean;
  skipped: string[];
}

function normalizeLegacyModels(raw: LegacyModelsFile | UnifiedModel[] | undefined): UnifiedModel[] {
  if (!raw) {
    return [];
  }

  return Array.isArray(raw) ? raw : raw.models ?? [];
}

function sanitizeProfileName(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "profile";
}

function nextProfileName(existing: Set<string>, desired: string): string {
  if (!existing.has(desired)) {
    existing.add(desired);
    return desired;
  }

  let index = 2;
  while (existing.has(`${desired}-${index}`)) {
    index += 1;
  }
  const next = `${desired}-${index}`;
  existing.add(next);
  return next;
}

export class MonoConfigStore {
  readonly cwd: string;
  readonly paths: MonoConfigPaths;

  constructor(cwd = process.cwd()) {
    this.cwd = cwd;
    this.paths = getMonoConfigPaths(cwd);
  }

  async ensureLayout(): Promise<void> {
    await Promise.all([
      mkdir(this.paths.globalDir, { recursive: true }),
      mkdir(join(this.paths.globalDir, "local"), { recursive: true }),
      mkdir(this.paths.globalMemoryDir, { recursive: true }),
      mkdir(this.paths.globalRulesDir, { recursive: true }),
      mkdir(this.paths.globalSkillsDir, { recursive: true }),
      mkdir(this.paths.globalSettingsDir, { recursive: true }),
      mkdir(this.paths.globalCacheDir, { recursive: true }),
      mkdir(this.paths.globalStateDir, { recursive: true }),
      mkdir(this.paths.globalSessionsDir, { recursive: true }),
      mkdir(this.paths.projectDir, { recursive: true }),
      mkdir(this.paths.projectMemoryDir, { recursive: true }),
      mkdir(this.paths.projectRulesDir, { recursive: true }),
      mkdir(this.paths.projectSkillsDir, { recursive: true }),
      mkdir(this.paths.projectSettingsDir, { recursive: true })
    ]);
  }

  async readGlobalConfig(): Promise<MonoGlobalConfig | undefined> {
    return readJsonFile<MonoGlobalConfig>(this.paths.globalConfigPath);
  }

  async writeGlobalConfig(config: MonoGlobalConfig): Promise<void> {
    await this.ensureLayout();
    await writeJsonFile(this.paths.globalConfigPath, config);
  }

  async readProjectConfig(): Promise<MonoProjectConfig | undefined> {
    const raw = await readJsonFile<{ version?: number; mono?: MonoProjectConfig } | MonoProjectConfig>(this.paths.projectConfigPath);
    if (!raw) {
      return undefined;
    }
    const wrapped = raw as { version?: number; mono?: MonoProjectConfig };
    if (wrapped.mono !== undefined) {
      return wrapped.mono;
    }
    return raw as MonoProjectConfig;
  }

  async writeProjectConfig(config: MonoProjectConfig): Promise<void> {
    await this.ensureLayout();
    await writeJsonFile(this.paths.projectConfigPath, { version: 1, mono: config });
  }

  async readSecrets(): Promise<MonoSecretsConfig | undefined> {
    return readJsonFile<MonoSecretsConfig>(this.paths.globalSecretsPath);
  }

  async writeSecrets(config: MonoSecretsConfig): Promise<void> {
    await this.ensureLayout();
    await writeJsonFile(this.paths.globalSecretsPath, config);
  }

  async initGlobalConfig(): Promise<MonoGlobalConfig> {
    const existing = await this.readGlobalConfig();
    if (existing) {
      return existing;
    }
    const config = createDefaultGlobalConfig();
    await this.writeGlobalConfig(config);
    return config;
  }

  async setProfileSecret(profileName: string, apiKey: string): Promise<void> {
    const secrets = (await this.readSecrets()) ?? { version: 1, profiles: {} };
    secrets.profiles[profileName] = { apiKey };
    await this.writeSecrets(secrets);
  }

  async deleteProfileSecret(profileName: string): Promise<void> {
    const secrets = await this.readSecrets();
    if (!secrets?.profiles[profileName]) {
      return;
    }
    delete secrets.profiles[profileName];
    await this.writeSecrets(secrets);
  }

  async migrateLegacy(cleanup = false): Promise<MigrationResult> {
    await this.ensureLayout();
    const result: MigrationResult = {
      migratedProfiles: [],
      migratedProjectConfig: false,
      migratedSessions: false,
      skipped: []
    };

    const config = (await this.readGlobalConfig()) ?? createDefaultGlobalConfig();
    const profileNames = new Set(Object.keys(config.mono.profiles));
    const legacyAgentsGlobalConfig = await readJsonFile<MonoGlobalConfig>(this.paths.legacyGlobalConfigPath);
    const legacyAgentsProjectConfig = await readJsonFile<{ version?: number; mono?: MonoProjectConfig } | MonoProjectConfig>(
      this.paths.legacyProjectConfigPath
    );
    const legacyGlobalModels = normalizeLegacyModels(
      await readJsonFile<LegacyModelsFile | UnifiedModel[]>(this.paths.legacyMonoModelsPath)
    );

    if (legacyAgentsGlobalConfig?.mono?.profiles) {
      for (const [profileName, profile] of Object.entries(legacyAgentsGlobalConfig.mono.profiles)) {
        const desired = nextProfileName(profileNames, sanitizeProfileName(profileName));
        config.mono.profiles[desired] = profile;
        result.migratedProfiles.push(desired);
      }
      if (!config.mono.defaultProfile && legacyAgentsGlobalConfig.mono.defaultProfile) {
        config.mono.defaultProfile = legacyAgentsGlobalConfig.mono.defaultProfile;
      }
    }

    for (const [index, model] of legacyGlobalModels.entries()) {
      const desired = index === 0 && !config.mono.profiles.default
        ? "default"
        : sanitizeProfileName(`${model.provider}-${model.modelId}`);
      const profileName = nextProfileName(profileNames, desired);
      const profile = modelToProfile(model);
      profile.apiKeyEnv = profile.apiKeyEnv ?? model.apiKeyEnv;
      config.mono.profiles[profileName] = profile;
      if (!config.mono.defaultProfile) {
        config.mono.defaultProfile = profileName;
      }
      result.migratedProfiles.push(profileName);
    }

    const legacyProjectModels = normalizeLegacyModels(
      await readJsonFile<LegacyModelsFile | UnifiedModel[]>(this.paths.legacyProjectMonoModelsPath)
    );

    if (legacyProjectModels.length > 0) {
      const first = legacyProjectModels[0];
      let chosenProfile = Object.entries(config.mono.profiles).find(([, profile]) =>
        profile.provider === first.provider && profile.modelId === first.modelId
      )?.[0];
      if (!chosenProfile) {
        chosenProfile = nextProfileName(profileNames, sanitizeProfileName(`${first.provider}-${first.modelId}`));
        config.mono.profiles[chosenProfile] = modelToProfile(first);
        result.migratedProfiles.push(chosenProfile);
      }
      await this.writeProjectConfig({
        profile: chosenProfile,
        provider: first.provider,
        modelId: first.modelId,
        baseURL: first.baseURL,
        apiKeyEnv: first.apiKeyEnv
      });
      result.migratedProjectConfig = true;
    }

    if (legacyAgentsProjectConfig) {
      const normalized = "mono" in legacyAgentsProjectConfig && legacyAgentsProjectConfig.mono
        ? legacyAgentsProjectConfig.mono
        : (legacyAgentsProjectConfig as MonoProjectConfig);
      await this.writeProjectConfig(normalized);
      result.migratedProjectConfig = true;
    }

    if (result.migratedProfiles.length > 0 || !(await this.readGlobalConfig())) {
      await this.writeGlobalConfig(config);
    }

    const legacyAgentsSecrets = await readJsonFile<MonoSecretsConfig>(this.paths.legacyGlobalSecretsPath);
    if (legacyAgentsSecrets) {
      await this.writeSecrets(legacyAgentsSecrets);
    }

    if (await exists(this.paths.legacyGlobalSessionsDir)) {
      const targetDir = this.paths.globalSessionsDir;
      const children = await readdir(this.paths.legacyGlobalSessionsDir).catch(() => []);
      if (children.length > 0) {
        await cp(this.paths.legacyGlobalSessionsDir, targetDir, { recursive: true, force: false, errorOnExist: false });
        result.migratedSessions = true;
      }
    }

    if (cleanup) {
      await Promise.all([
        safeRemove(this.paths.legacyGlobalConfigPath),
        safeRemove(this.paths.legacyGlobalSecretsPath),
        safeRemove(this.paths.legacyProjectConfigPath),
        safeRemove(this.paths.legacyMonoModelsPath),
        safeRemove(this.paths.legacyProjectMonoModelsPath),
        result.migratedSessions ? safeRemove(this.paths.legacyGlobalSessionsDir) : Promise.resolve()
      ]);
    }

    return result;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeRemove(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}
