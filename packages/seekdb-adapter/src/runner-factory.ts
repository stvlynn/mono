import type { MonoSeekDbConfig } from "@mono/shared";
import type { SeekDbRunner } from "./types.js";
import { SeekDbMySqlRunner } from "./mysql-runner.js";
import { SeekDbPythonEmbeddedRunner } from "./python-embedded-runner.js";

export function createSeekDbRunner(config: MonoSeekDbConfig): SeekDbRunner {
  if (config.mode === "python-embedded") {
    return new SeekDbPythonEmbeddedRunner({
      pythonExecutable: config.pythonExecutable ?? "python3",
      pythonModule: config.pythonModule ?? "seekdb",
      embeddedPath: config.embeddedPath,
      timeoutMs: config.timeoutMs
    });
  }

  return new SeekDbMySqlRunner({
    mysqlBinary: config.mysqlBinary,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    passwordEnv: config.passwordEnv,
    timeoutMs: config.timeoutMs
  });
}
