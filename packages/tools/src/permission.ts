import type {
  ApprovalRequest,
  AgentTool,
  PermissionDecision,
  PermissionPolicy,
  PermissionRequest,
  ToolExecutionChannel,
} from "@mono/shared";

export interface DefaultPermissionPolicyOptions {
  allowlistedChannels?: ToolExecutionChannel[];
  commandDenylist?: string[];
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

  constructor(options: DefaultPermissionPolicyOptions = {}) {
    this.allowlistedChannels = options.allowlistedChannels ?? [];
    this.commandDenylist = options.commandDenylist
      ?.map((value) => normalizeCommand(value))
      .filter(Boolean) ?? [];
  }

  evaluate(request: PermissionRequest): PermissionDecision {
    if (request.toolName === "read") {
      return { type: "allow" };
    }

    if (request.toolName === "bash" && typeof request.input === "object" && request.input !== null) {
      const command = normalizeCommand(String((request.input as { command?: string }).command ?? ""));
      if (matchesDestructiveCommand(command)) {
        return { type: "deny", reason: "Command matches destructive denylist" };
      }
      if (this.matchesConfiguredCommandDenylist(command)) {
        return { type: "deny", reason: "Command matches configured denylist" };
      }
      if (this.isAllowlistedChannel(request.channel)) {
        return { type: "allow" };
      }
      return { type: "ask", reason: "bash commands require confirmation by default" };
    }

    if (this.isAllowlistedChannel(request.channel)) {
      return { type: "allow" };
    }

    return { type: "ask", reason: `${request.toolName} requires confirmation by default` };
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

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/gu, " ").toLowerCase();
}
