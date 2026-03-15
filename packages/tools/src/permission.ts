import type {
  ApprovalRequest,
  AgentTool,
  MonoSensitiveActionMode,
  PermissionDecision,
  PermissionPolicy,
  PermissionRequest,
  ToolExecutionChannel,
} from "@mono/shared";

export interface DefaultPermissionPolicyOptions {
  allowlistedChannels?: ToolExecutionChannel[];
  commandDenylist?: string[];
  sensitiveActionMode?: MonoSensitiveActionMode;
}

export interface WrappedToolOptions {
  cwd: string;
  sessionId: string;
  policy: PermissionPolicy;
  channel?: ToolExecutionChannel;
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  emit: (event: { type: "approval-request"; request: ApprovalRequest } | { type: "approval-result"; toolName: string; approved: boolean; reason?: string }) => void;
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  private readonly allowlistedChannels: ToolExecutionChannel[];
  private readonly commandDenylist: string[];
  private readonly sensitiveActionMode: MonoSensitiveActionMode;

  constructor(options: DefaultPermissionPolicyOptions = {}) {
    this.allowlistedChannels = options.allowlistedChannels ?? [];
    this.commandDenylist = options.commandDenylist
      ?.map((value) => normalizeCommand(value))
      .filter(Boolean) ?? [];
    this.sensitiveActionMode = options.sensitiveActionMode ?? "blacklist";
  }

  evaluate(request: PermissionRequest): PermissionDecision {
    if (request.toolName === "read") {
      return allowDecision();
    }

    if (isBashPermissionRequest(request)) {
      return this.evaluateBashRequest(request);
    }

    if (this.isAllowlistedChannel(request.channel)) {
      return allowDecision();
    }

    return askDecision(`${request.toolName} requires confirmation by default`);
  }

  private matchesConfiguredCommandDenylist(command: string): boolean {
    return this.commandDenylist.some((entry) => command.includes(entry));
  }

  private isAllowlistedChannel(channel: ToolExecutionChannel | undefined): boolean {
    if (!channel) {
      return false;
    }

    return this.allowlistedChannels.some((candidate) =>
      candidate.platform === channel.platform
      && candidate.id === channel.id
      && candidate.kind === channel.kind,
    );
  }

  private evaluateBashRequest(request: PermissionRequest & { toolName: "bash"; input: object }): PermissionDecision {
    const command = getNormalizedBashCommand(request.input);
    if (matchesDestructiveCommand(command)) {
      return denyDecision("Command matches destructive denylist");
    }
    if (this.matchesConfiguredCommandDenylist(command)) {
      return denyDecision("Command matches configured denylist");
    }
    if (!this.isAllowlistedChannel(request.channel)) {
      return askDecision("bash commands require confirmation by default");
    }

    return this.evaluateSensitiveBashCommand(command) ?? allowDecision();
  }

  private evaluateSensitiveBashCommand(command: string): PermissionDecision | null {
    if (this.sensitiveActionMode === "allow_all") {
      return null;
    }

    if (this.sensitiveActionMode === "strict") {
      return askDecision("Strict mode requires confirmation for every bash command");
    }

    if (matchesSensitiveCommand(command)) {
      return askDecision("Sensitive bash command requires confirmation");
    }

    return null;
  }
}

export function wrapToolWithPermissions<TTool extends AgentTool>(tool: TTool, options: WrappedToolOptions): TTool {
  return {
    ...tool,
    execute: async (args, context) => {
      const decision = options.policy.evaluate({
        toolName: tool.name,
        input: args,
        cwd: options.cwd,
        sessionId: options.sessionId,
        channel: options.channel,
      });

      if (decision.type === "deny") {
        options.emit({ type: "approval-result", toolName: tool.name, approved: false, reason: decision.reason });
        throw new Error(decision.reason);
      }

      if (decision.type === "ask") {
        const request = {
          toolName: tool.name,
          input: args,
          cwd: options.cwd,
          sessionId: options.sessionId,
          channel: options.channel,
          reason: decision.reason
        };
        options.emit({ type: "approval-request", request });
        const approved = await options.requestApproval(request);
        options.emit({
          type: "approval-result",
          toolName: tool.name,
          approved,
          reason: approved ? undefined : "User denied tool execution"
        });
        if (!approved) {
          throw new Error("User denied tool execution");
        }
      }

      return tool.execute(args, context);
    }
  };
}

function matchesDestructiveCommand(command: string): boolean {
  return /(^|\s)(rm\s+-rf|git\s+reset\s+--hard|mkfs|dd\s+if=)/.test(command);
}

function matchesSensitiveCommand(command: string): boolean {
  return /(^|[;&|]\s*|\s)(rm|rmdir|unlink|mv|chmod|chown|sudo)\b/.test(command)
    || /(^|[;&|]\s*)git\s+(clean|checkout\s+--|reset\b)/.test(command)
    || /(^|[;&|]\s*)find\b.*\s-delete(\s|$)/.test(command);
}

function isBashPermissionRequest(request: PermissionRequest): request is PermissionRequest & { toolName: "bash"; input: object } {
  return request.toolName === "bash" && typeof request.input === "object" && request.input !== null;
}

function getNormalizedBashCommand(input: object): string {
  return normalizeCommand(String((input as { command?: string }).command ?? ""));
}

function allowDecision(): PermissionDecision {
  return { type: "allow" };
}

function denyDecision(reason: string): PermissionDecision {
  return { type: "deny", reason };
}

function askDecision(reason: string): PermissionDecision {
  return { type: "ask", reason };
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/gu, " ").toLowerCase();
}
