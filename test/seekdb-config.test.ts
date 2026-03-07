import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultMemoryConfig } from "../packages/config/src/defaults.js";
import { resolveMonoConfig } from "../packages/config/src/resolver.js";
import { writeJsonFile, type MonoGlobalConfig, type MonoProjectConfig } from "../packages/shared/src/index.js";

const tempPaths: string[] = [];
const originalMonoConfigDir = process.env.MONO_CONFIG_DIR;
const originalSeekDbMode = process.env.MONO_SEEKDB_MODE;
const originalSeekDbDatabase = process.env.MONO_SEEKDB_DATABASE;
const originalSeekDbHost = process.env.MONO_SEEKDB_HOST;
const originalSeekDbPython = process.env.MONO_SEEKDB_PYTHON;
const originalSeekDbEmbeddedPath = process.env.MONO_SEEKDB_EMBEDDED_PATH;

afterEach(async () => {
  if (originalMonoConfigDir === undefined) {
    delete process.env.MONO_CONFIG_DIR;
  } else {
    process.env.MONO_CONFIG_DIR = originalMonoConfigDir;
  }

  if (originalSeekDbMode === undefined) {
    delete process.env.MONO_SEEKDB_MODE;
  } else {
    process.env.MONO_SEEKDB_MODE = originalSeekDbMode;
  }

  if (originalSeekDbDatabase === undefined) {
    delete process.env.MONO_SEEKDB_DATABASE;
  } else {
    process.env.MONO_SEEKDB_DATABASE = originalSeekDbDatabase;
  }

  if (originalSeekDbHost === undefined) {
    delete process.env.MONO_SEEKDB_HOST;
  } else {
    process.env.MONO_SEEKDB_HOST = originalSeekDbHost;
  }

  if (originalSeekDbPython === undefined) {
    delete process.env.MONO_SEEKDB_PYTHON;
  } else {
    process.env.MONO_SEEKDB_PYTHON = originalSeekDbPython;
  }

  if (originalSeekDbEmbeddedPath === undefined) {
    delete process.env.MONO_SEEKDB_EMBEDDED_PATH;
  } else {
    process.env.MONO_SEEKDB_EMBEDDED_PATH = originalSeekDbEmbeddedPath;
  }

  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SeekDB memory config", () => {
  it("provides stable defaults for evaluation mode", () => {
    delete process.env.MONO_SEEKDB_MODE;
    delete process.env.MONO_SEEKDB_DATABASE;
    delete process.env.MONO_SEEKDB_HOST;
    delete process.env.MONO_SEEKDB_PYTHON;
    delete process.env.MONO_SEEKDB_EMBEDDED_PATH;
    const config = createDefaultMemoryConfig();

    expect(config.retrievalBackend).toBe("local");
    expect(config.fallbackToLocalOnFailure).toBe(true);
    expect(config.seekDb.enabled).toBe(false);
    expect(config.seekDb.mode).toBe("mysql");
    expect(config.seekDb.mysqlBinary).toBe("mysql");
    expect(config.seekDb.pythonExecutable).toBe("python3");
    expect(config.seekDb.pythonModule).toBe("seekdb");
    expect(config.seekDb.timeoutMs).toBe(30_000);
    expect(config.seekDb.mirrorSessionsOnly).toBe(true);
  });

  it("deep-merges SeekDB config across global, project, and env layers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-seekdb-cwd-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-seekdb-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;
    process.env.MONO_SEEKDB_MODE = "python-embedded";
    process.env.MONO_SEEKDB_PYTHON = "python3.13";
    process.env.MONO_SEEKDB_EMBEDDED_PATH = "/tmp/seekdb-eval";

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
          retrievalBackend: "seekdb",
          fallbackToLocalOnFailure: false,
          seekDb: {
            enabled: true,
            mode: "mysql",
            timeoutMs: 15_000,
            mysqlBinary: "mysql8",
            host: "global-db.example",
            port: 3306,
            database: "mono_eval",
            user: "mono",
            passwordEnv: "SEEKDB_PASSWORD",
            pythonExecutable: "python3",
            pythonModule: "seekdb",
            mirrorSessionsOnly: false
          }
        }
      },
      projects: {}
    };
    const projectConfig: MonoProjectConfig = {
      profile: "default",
      memory: {
        fallbackToLocalOnFailure: true,
        seekDb: {
          host: "project-db.example",
          database: "mono_project_eval",
          mirrorSessionsOnly: true
        }
      }
    };

    await writeJsonFile(join(configDir, "config.json"), globalConfig);
    await writeJsonFile(join(cwd, ".mono", "config.json"), projectConfig);

    const resolved = await resolveMonoConfig({ cwd });

    expect(resolved.memory.retrievalBackend).toBe("seekdb");
    expect(resolved.memory.fallbackToLocalOnFailure).toBe(true);
    expect(resolved.memory.seekDb.enabled).toBe(true);
    expect(resolved.memory.seekDb.mode).toBe("python-embedded");
    expect(resolved.memory.seekDb.timeoutMs).toBe(15_000);
    expect(resolved.memory.seekDb.host).toBe("project-db.example");
    expect(resolved.memory.seekDb.database).toBe("mono_project_eval");
    expect(resolved.memory.seekDb.user).toBe("mono");
    expect(resolved.memory.seekDb.passwordEnv).toBe("SEEKDB_PASSWORD");
    expect(resolved.memory.seekDb.pythonExecutable).toBe("python3.13");
    expect(resolved.memory.seekDb.pythonModule).toBe("seekdb");
    expect(resolved.memory.seekDb.embeddedPath).toBe("/tmp/seekdb-eval");
    expect(resolved.memory.seekDb.mirrorSessionsOnly).toBe(true);
  });
});
