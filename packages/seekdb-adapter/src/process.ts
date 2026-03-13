import { spawn } from "node:child_process";

export async function runProcess(options: {
  command: string;
  args: string[];
  input?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(options.command, options.args, {
    env: {
      ...process.env,
      ...options.env
    },
    stdio: "pipe"
  });

  let stdout = "";
  let stderr = "";
  let timeout: NodeJS.Timeout | undefined;

  const result = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(
        `Command failed: ${options.command} ${options.args.join(" ")} (code=${code ?? "null"}, signal=${signal ?? "null"})${
          stderr ? `\n${stderr.trim()}` : ""
        }`
      ) as Error & { stdout?: string; stderr?: string; code?: number | null; signal?: NodeJS.Signals | null };
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = code;
      error.signal = signal;
      reject(error);
    });
  });

  if (options.timeoutMs && options.timeoutMs > 0) {
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeoutMs);
  }

  if (options.input) {
    child.stdin.write(options.input);
  }
  child.stdin.end();

  return result;
}
