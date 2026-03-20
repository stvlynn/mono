import { describe, expect, it } from "vitest";
import type { AgentTool, ToolCallContext, ToolExecutionResult } from "../packages/shared/src/index.js";
import { createAutoRepairingBashTool } from "../packages/tools/src/bash-auto-repair.js";
import type { BashToolDetails } from "../packages/tools/src/bash.js";

type BashArgs = {
  command: string;
  timeout?: number;
};

function createResult(content: string, exitCode: number | null): ToolExecutionResult<BashToolDetails> {
  return {
    content,
    details: {
      exitCode,
      truncated: false,
    },
  };
}

describe("bash auto repair", () => {
  it("installs a mapped missing command and retries the original bash command", async () => {
    const commands: string[] = [];
    let originalAttempts = 0;

    const baseTool: AgentTool<BashArgs, BashToolDetails> = {
      name: "bash",
      description: "bash",
      inputSchema: {},
      execute: async (args, _context) => {
        commands.push(args.command);

        if (args.command === "curl -I https://example.com") {
          originalAttempts += 1;
          return originalAttempts === 1
            ? createResult("bash: line 1: curl: command not found\n", 127)
            : createResult("HTTP/1.1 200 OK\n", 0);
        }

        if (args.command === "if command -v apt-get >/dev/null 2>&1; then echo apt-get; fi") {
          return createResult("apt-get\n", 0);
        }

        if (args.command.includes("apt-get install -y --no-install-recommends curl")) {
          return createResult("installed curl\n", 0);
        }

        throw new Error(`Unexpected command: ${args.command}`);
      },
    };

    const tool = createAutoRepairingBashTool(baseTool);
    const result = await tool.execute(
      { command: "curl -I https://example.com" },
      { toolCallId: "tool-1" } satisfies ToolCallContext,
    );

    expect(commands).toEqual([
      "curl -I https://example.com",
      "if command -v apt-get >/dev/null 2>&1; then echo apt-get; fi",
      "export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y --no-install-recommends curl",
      "curl -I https://example.com",
    ]);
    expect(result.content).toContain("[auto-repair] Installed missing commands via apt-get: curl.");
    expect(result.content).toContain("HTTP/1.1 200 OK");
    expect(result.details?.autoRepair).toEqual({
      attempted: true,
      packageManager: "apt-get",
      missingCommands: ["curl"],
      installedPackages: ["curl"],
      retried: true,
      succeeded: true,
    });
  });

  it("does not attempt auto repair for unmapped missing commands", async () => {
    const commands: string[] = [];

    const baseTool: AgentTool<BashArgs, BashToolDetails> = {
      name: "bash",
      description: "bash",
      inputSchema: {},
      execute: async (args) => {
        commands.push(args.command);
        return createResult("bash: line 1: foocmd: command not found\n", 127);
      },
    };

    const tool = createAutoRepairingBashTool(baseTool);
    const result = await tool.execute(
      { command: "foocmd --version" },
      { toolCallId: "tool-2" } satisfies ToolCallContext,
    );

    expect(commands).toEqual(["foocmd --version"]);
    expect(result.content).toBe("bash: line 1: foocmd: command not found\n");
    expect(result.details?.autoRepair).toBeUndefined();
  });

  it("returns the install result when auto repair fails", async () => {
    const commands: string[] = [];

    const baseTool: AgentTool<BashArgs, BashToolDetails> = {
      name: "bash",
      description: "bash",
      inputSchema: {},
      execute: async (args) => {
        commands.push(args.command);

        if (args.command === "git clone https://example.com/repo.git") {
          return createResult("bash: line 1: git: command not found\n", 127);
        }

        if (args.command === "if command -v apt-get >/dev/null 2>&1; then echo apt-get; fi") {
          return createResult("apt-get\n", 0);
        }

        if (args.command.includes("apt-get install -y --no-install-recommends git")) {
          return createResult("E: failed to fetch package indexes\n", 100);
        }

        throw new Error(`Unexpected command: ${args.command}`);
      },
    };

    const tool = createAutoRepairingBashTool(baseTool);
    const result = await tool.execute(
      { command: "git clone https://example.com/repo.git" },
      { toolCallId: "tool-3" } satisfies ToolCallContext,
    );

    expect(commands).toHaveLength(3);
    expect(result.content).toBe("E: failed to fetch package indexes\n");
    expect(result.details?.autoRepair).toEqual({
      attempted: true,
      packageManager: "apt-get",
      missingCommands: ["git"],
      installedPackages: ["git"],
      retried: false,
      succeeded: false,
    });
  });

  it("requests approval before installing missing commands", async () => {
    const commands: string[] = [];
    const approvalRequests: Array<{
      command: string;
      packageManager: string;
      missingCommands: string[];
      installedPackages: string[];
    }> = [];

    const baseTool: AgentTool<BashArgs, BashToolDetails> = {
      name: "bash",
      description: "bash",
      inputSchema: {},
      execute: async (args) => {
        commands.push(args.command);

        if (args.command === "curl -I https://example.com") {
          return createResult("bash: line 1: curl: command not found\n", 127);
        }

        if (args.command === "if command -v apt-get >/dev/null 2>&1; then echo apt-get; fi") {
          return createResult("apt-get\n", 0);
        }

        throw new Error(`Unexpected command: ${args.command}`);
      },
    };

    const tool = createAutoRepairingBashTool(baseTool, {
      requestInstallApproval: async (request) => {
        approvalRequests.push(request);
        return false;
      },
    });
    const result = await tool.execute(
      { command: "curl -I https://example.com" },
      { toolCallId: "tool-4" } satisfies ToolCallContext,
    );

    expect(commands).toEqual([
      "curl -I https://example.com",
      "if command -v apt-get >/dev/null 2>&1; then echo apt-get; fi",
    ]);
    expect(approvalRequests).toEqual([{
      command: "curl -I https://example.com",
      packageManager: "apt-get",
      missingCommands: ["curl"],
      installedPackages: ["curl"],
    }]);
    expect(result.content).toContain("approval denied");
    expect(result.details?.autoRepair).toEqual({
      attempted: true,
      packageManager: "apt-get",
      missingCommands: ["curl"],
      installedPackages: ["curl"],
      retried: false,
      succeeded: false,
    });
  });

  it("retries auto repair after an earlier install attempt failed", async () => {
    const commands: string[] = [];
    let originalAttempts = 0;
    let installAttempts = 0;

    const baseTool: AgentTool<BashArgs, BashToolDetails> = {
      name: "bash",
      description: "bash",
      inputSchema: {},
      execute: async (args) => {
        commands.push(args.command);

        if (args.command === "git clone https://example.com/repo.git") {
          originalAttempts += 1;
          return originalAttempts < 3
            ? createResult("bash: line 1: git: command not found\n", 127)
            : createResult("cloned\n", 0);
        }

        if (args.command === "if command -v apt-get >/dev/null 2>&1; then echo apt-get; fi") {
          return createResult("apt-get\n", 0);
        }

        if (args.command.includes("apt-get install -y --no-install-recommends git")) {
          installAttempts += 1;
          return installAttempts === 1
            ? createResult("E: temporary failure\n", 100)
            : createResult("installed git\n", 0);
        }

        throw new Error(`Unexpected command: ${args.command}`);
      },
    };

    const tool = createAutoRepairingBashTool(baseTool);
    const firstResult = await tool.execute(
      { command: "git clone https://example.com/repo.git" },
      { toolCallId: "tool-5" } satisfies ToolCallContext,
    );
    const secondResult = await tool.execute(
      { command: "git clone https://example.com/repo.git" },
      { toolCallId: "tool-6" } satisfies ToolCallContext,
    );

    expect(firstResult.details?.autoRepair?.succeeded).toBe(false);
    expect(secondResult.details?.autoRepair?.succeeded).toBe(true);
    expect(installAttempts).toBe(2);
    expect(commands.filter((command) => command.includes("apt-get install -y --no-install-recommends git"))).toHaveLength(2);
  });
});
