import type { AgentTool, ToolCallContext, ToolExecutionResult } from "@mono/shared";
import type { BashToolDetails } from "./bash.js";

type BashArgs = {
  command: string;
  timeout?: number;
};

type BashTool = AgentTool<BashArgs, BashToolDetails>;
type PackageManager = "apt-get";

const COMMAND_PACKAGE_MAP: Record<string, string> = {
  curl: "curl",
  git: "git",
  python: "python3",
  python3: "python3",
  pip: "python3-pip",
  pip3: "python3-pip",
  wget: "wget",
};

const PACKAGE_MANAGER_PROBE_COMMAND = "if command -v apt-get >/dev/null 2>&1; then echo apt-get; fi";

export interface BashAutoRepairDetails {
  attempted: boolean;
  packageManager?: PackageManager;
  missingCommands?: string[];
  installedPackages?: string[];
  retried: boolean;
  succeeded: boolean;
}

export interface BashAutoRepairApprovalRequest {
  command: string;
  packageManager: PackageManager;
  missingCommands: string[];
  installedPackages: string[];
}

export function createAutoRepairingBashTool(
  tool: BashTool,
  options: {
    requestInstallApproval?: (request: BashAutoRepairApprovalRequest) => Promise<boolean>;
  } = {},
): BashTool {
  let packageManagerPromise: Promise<PackageManager | null> | undefined;
  const attemptedRepairs = new Set<string>();

  return {
    ...tool,
    execute: async (args, context) => {
      const initialResult = await tool.execute(args, context);
      const missingCommands = parseMissingCommands(initialResult.content);
      const installableCommands = missingCommands.filter((command) => COMMAND_PACKAGE_MAP[command]);
      if (!shouldAttemptRepair(args.command, installableCommands, attemptedRepairs)) {
        return initialResult;
      }

      const packageManager = await resolvePackageManager(tool, context, packageManagerPromise);
      if (packageManagerPromise === undefined) {
        packageManagerPromise = Promise.resolve(packageManager);
      }
      if (!packageManager) {
        return annotateResult(initialResult, {
          attempted: true,
          missingCommands: installableCommands,
          retried: false,
          succeeded: false,
        });
      }

      const installedPackages = unique(
        installableCommands
          .map((command) => COMMAND_PACKAGE_MAP[command])
          .filter(Boolean),
      );
      if (installedPackages.length === 0) {
        return initialResult;
      }

      if (options.requestInstallApproval) {
        const approved = await options.requestInstallApproval({
          command: args.command,
          packageManager,
          missingCommands: installableCommands,
          installedPackages,
        });
        if (!approved) {
          return annotateResult(initialResult, {
            attempted: true,
            packageManager,
            missingCommands: installableCommands,
            installedPackages,
            retried: false,
            succeeded: false,
          }, `[auto-repair] Skipped installing missing commands via ${packageManager}: approval denied.`);
        }
      }

      const installResult = await tool.execute(
        {
          command: buildInstallCommand(packageManager, installedPackages),
          timeout: 180,
        },
        createInternalToolContext(context),
      );

      if ((installResult.details?.exitCode ?? 1) !== 0) {
        return annotateResult(installResult, {
          attempted: true,
          packageManager,
          missingCommands: installableCommands,
          installedPackages,
          retried: false,
          succeeded: false,
        });
      }

      for (const command of installableCommands) {
        attemptedRepairs.add(command);
      }

      const retriedResult = await tool.execute(args, context);
      return annotateResult(retriedResult, {
        attempted: true,
        packageManager,
        missingCommands: installableCommands,
        installedPackages,
        retried: true,
        succeeded: (retriedResult.details?.exitCode ?? 1) === 0,
      }, `[auto-repair] Installed missing commands via ${packageManager}: ${installedPackages.join(", ")}.`);
    },
  };
}

function shouldAttemptRepair(
  command: string,
  missingCommands: string[],
  attemptedRepairs: Set<string>,
): boolean {
  if (missingCommands.length === 0) {
    return false;
  }

  if (/\b(apt-get|apt|apk|yum|dnf)\b/.test(command)) {
    return false;
  }

  return missingCommands.some((missingCommand) => !attemptedRepairs.has(missingCommand));
}

async function resolvePackageManager(
  tool: BashTool,
  context: ToolCallContext,
  packageManagerPromise: Promise<PackageManager | null> | undefined,
): Promise<PackageManager | null> {
  if (packageManagerPromise) {
    return packageManagerPromise;
  }

  const probeResult = await tool.execute(
    { command: PACKAGE_MANAGER_PROBE_COMMAND, timeout: 5 },
    createInternalToolContext(context),
  );
  const output = toolResultToText(probeResult).trim();
  return output === "apt-get" ? "apt-get" : null;
}

function buildInstallCommand(packageManager: PackageManager, packages: string[]): string {
  if (packageManager === "apt-get") {
    return [
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update",
      `apt-get install -y --no-install-recommends ${packages.join(" ")}`
    ].join(" && ");
  }

  return "";
}

function annotateResult(
  result: ToolExecutionResult<BashToolDetails>,
  autoRepair: BashAutoRepairDetails,
  prefix?: string,
): ToolExecutionResult<BashToolDetails> {
  const details = result.details ?? {
    exitCode: null,
    truncated: false,
  };
  return {
    ...result,
    content: prependContent(result.content, prefix),
    details: {
      ...details,
      autoRepair,
    },
  };
}

function prependContent(content: ToolExecutionResult["content"], prefix?: string) {
  if (!prefix) {
    return content;
  }

  if (typeof content === "string") {
    return `${prefix}\n${content}`.trim();
  }

  return [{ type: "text" as const, text: prefix }, ...content];
}

function toolResultToText(result: ToolExecutionResult<BashToolDetails>): string {
  if (typeof result.content === "string") {
    return result.content;
  }

  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function parseMissingCommands(content: ToolExecutionResult["content"]): string[] {
  const text = typeof content === "string"
    ? content
    : content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  const matches = [...text.matchAll(/(?:^|:\s|line\s+\d+:\s)([a-z0-9._-]+):\s+command not found/giu)];
  return unique(matches
    .map((match) => match[1]?.trim().toLowerCase())
    .filter((command): command is string => Boolean(command) && command !== "bash"));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function createInternalToolContext(context: ToolCallContext): ToolCallContext {
  return {
    toolCallId: `${context.toolCallId}:autorepair`,
    signal: context.signal,
  };
}
