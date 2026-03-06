import { homedir } from "node:os";
import { join } from "node:path";

export interface MonoConfigPaths {
  globalDir: string;
  globalConfigPath: string;
  globalSecretsPath: string;
  globalSessionsDir: string;
  globalRulesDir: string;
  globalSkillsDir: string;
  globalSettingsDir: string;
  globalCacheDir: string;
  globalStateDir: string;
  projectDir: string;
  projectConfigPath: string;
  projectRulesDir: string;
  projectSkillsDir: string;
  projectSettingsDir: string;
  legacyGlobalDir: string;
  legacyGlobalConfigPath: string;
  legacyGlobalSecretsPath: string;
  legacyGlobalSessionsDir: string;
  legacyProjectDir: string;
  legacyProjectConfigPath: string;
  legacyMonoModelsPath: string;
  legacyProjectMonoModelsPath: string;
}

export function getMonoConfigDir(): string {
  return process.env.MONO_CONFIG_DIR || join(homedir(), ".mono");
}

export function getMonoConfigPaths(cwd = process.cwd()): MonoConfigPaths {
  const globalDir = getMonoConfigDir();
  const projectDir = join(cwd, ".mono");
  const legacyGlobalDir = join(homedir(), ".agents");
  const legacyProjectDir = join(cwd, ".agents");
  return {
    globalDir,
    globalConfigPath: join(globalDir, "config.json"),
    globalSecretsPath: join(globalDir, "local", "secrets.json"),
    globalSessionsDir: join(globalDir, "sessions"),
    globalRulesDir: join(globalDir, "rules"),
    globalSkillsDir: join(globalDir, "skills"),
    globalSettingsDir: join(globalDir, "settings"),
    globalCacheDir: join(globalDir, "cache"),
    globalStateDir: join(globalDir, "state"),
    projectDir,
    projectConfigPath: join(projectDir, "config.json"),
    projectRulesDir: join(projectDir, "rules"),
    projectSkillsDir: join(projectDir, "skills"),
    projectSettingsDir: join(projectDir, "settings"),
    legacyGlobalDir,
    legacyGlobalConfigPath: join(legacyGlobalDir, "config.json"),
    legacyGlobalSecretsPath: join(legacyGlobalDir, "local", "secrets.json"),
    legacyGlobalSessionsDir: join(legacyGlobalDir, "sessions"),
    legacyProjectDir,
    legacyProjectConfigPath: join(legacyProjectDir, "config.json"),
    legacyMonoModelsPath: join(globalDir, "models.json"),
    legacyProjectMonoModelsPath: join(projectDir, "models.json")
  };
}
