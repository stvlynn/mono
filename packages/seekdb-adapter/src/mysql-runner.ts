import type { SeekDbRunner } from "./types.js";
import { runProcess } from "./process.js";

export class SeekDbMySqlRunner implements SeekDbRunner {
  constructor(
    private readonly config: {
      mysqlBinary: string;
      host?: string;
      port?: number;
      database?: string;
      user?: string;
      passwordEnv?: string;
      timeoutMs?: number;
    }
  ) {
    if (!config.database) {
      throw new Error("SeekDB MySQL mode requires seekDb.database to be configured");
    }
  }

  async health(): Promise<unknown> {
    const rows = await this.queryRows("SELECT 'ok' AS payload");
    return {
      ok: rows[0] === "ok",
      mode: "mysql"
    };
  }

  async execute(statements: string[]): Promise<void> {
    await this.runSql(statements.join(";\n") + ";\n");
  }

  async queryRows(sql: string): Promise<string[]> {
    const { stdout } = await this.runSql(`${sql.trim().replace(/;+\s*$/, "")};\n`);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async runSql(sql: string): Promise<{ stdout: string; stderr: string }> {
    const args = [
      "--batch",
      "--raw",
      "--silent",
      "--skip-column-names",
      "--default-character-set=utf8mb4"
    ];
    if (this.config.host) {
      args.push("--host", this.config.host);
    }
    if (this.config.port) {
      args.push("--port", String(this.config.port));
    }
    if (this.config.user) {
      args.push("--user", this.config.user);
    }
    args.push(this.config.database!);

    const password = this.config.passwordEnv ? process.env[this.config.passwordEnv] : undefined;
    return runProcess({
      command: this.config.mysqlBinary,
      args,
      input: sql,
      env: password ? { MYSQL_PWD: password } : undefined,
      timeoutMs: this.config.timeoutMs
    });
  }
}
