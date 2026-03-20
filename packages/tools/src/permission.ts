import type {
  ApprovalPolicy,
  ApprovalRequest,
  AgentTool,
  MonoSensitiveActionMode,
  PermissionDecision,
  PermissionPolicy,
  PermissionRequest,
  SandboxMode,
  ToolExecutionChannel,
} from "@mono/shared";

export interface DefaultPermissionPolicyOptions {
  allowlistedChannels?: ToolExecutionChannel[];
  commandDenylist?: string[];
  sensitiveActionMode?: MonoSensitiveActionMode;
  approvalPolicy?: ApprovalPolicy;
  sandboxMode?: SandboxMode;
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
  private readonly approvalPolicy: ApprovalPolicy;
  private readonly sandboxMode: SandboxMode;

  constructor(options: DefaultPermissionPolicyOptions = {}) {
    this.allowlistedChannels = options.allowlistedChannels ?? [];
    this.commandDenylist = options.commandDenylist
      ?.map((value) => normalizeCommand(value))
      .filter(Boolean) ?? [];
    this.sensitiveActionMode = options.sensitiveActionMode ?? "blacklist";
    this.approvalPolicy = options.approvalPolicy ?? "on-request";
    this.sandboxMode = requireSupportedSandboxMode(options.sandboxMode ?? "danger-full-access");
  }

  evaluate(request: PermissionRequest): PermissionDecision {
    if (request.toolName === "read") {
      return allowDecision();
    }

    if (this.sandboxMode === "read-only" && isBlockedInReadOnlySandbox(request.toolName)) {
      return denyDecision(`Sandbox mode ${this.sandboxMode} forbids ${request.toolName}`);
    }

    if (isChannelActionPermissionRequest(request)) {
      return this.evaluateChannelActionRequest(request);
    }

    if (isChannelStorePermissionRequest(request)) {
      return this.evaluateChannelStoreRequest(request);
    }

    if (isBashPermissionRequest(request)) {
      return this.evaluateBashRequest(request);
    }

    if (this.isAllowlistedChannel(request.channel)) {
      return allowDecision();
    }

    return this.applyApprovalPolicy(askDecision(`${request.toolName} requires confirmation by default`));
  }

  private matchesConfiguredCommandDenylist(command: string): boolean {
    return this.commandDenylist.some((entry) => command.includes(entry));
  }

  isAllowlistedChannel(channel: ToolExecutionChannel | undefined): boolean {
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
      return this.applyApprovalPolicy(askDecision("Command matches destructive denylist"));
    }
    if (this.matchesConfiguredCommandDenylist(command)) {
      return this.applyApprovalPolicy(askDecision("Command matches configured denylist"));
    }

    return this.applyApprovalPolicy(this.evaluateSensitiveBashCommand(command) ?? allowDecision());
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

  private evaluateChannelActionRequest(
    request: PermissionRequest & { toolName: "channel_action"; input: object },
  ): PermissionDecision {
    const input = request.input as {
      action?: string;
      targetId?: string;
      channel?: string;
    };
    const action = String(input.action ?? "").trim().toLowerCase();
    const targetId = typeof input.targetId === "string" ? input.targetId.trim() : "";
    const currentTargetId = request.channel?.id ?? "";

    if (!this.isAllowlistedChannel(request.channel)) {
      return this.applyApprovalPolicy(askDecision("channel_action requires confirmation by default"));
    }

    if (targetId && currentTargetId && targetId !== currentTargetId) {
      return this.applyApprovalPolicy(askDecision("channel_action targeting another conversation requires confirmation"));
    }

    if (action === "edit" || action === "delete") {
      return this.applyApprovalPolicy(askDecision(`channel_action ${action} requires confirmation`));
    }

    return allowDecision();
  }

  private evaluateChannelStoreRequest(
    request: PermissionRequest & { toolName: "channel_store"; input: object },
  ): PermissionDecision {
    const input = request.input as { action?: string };
    const action = String(input.action ?? "").trim().toLowerCase();
    if (action === "list" || action === "search") {
      return allowDecision();
    }

    return this.applyApprovalPolicy(askDecision(`channel_store ${action || "upsert"} requires confirmation`));
  }

  private applyApprovalPolicy(decision: PermissionDecision): PermissionDecision {
    if (decision.type !== "ask") {
      return decision;
    }

    if (this.approvalPolicy === "never") {
      return denyDecision("Approval policy is set to never");
    }

    if (this.approvalPolicy === "auto-approve") {
      return allowDecision();
    }

    return decision;
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

function isChannelActionPermissionRequest(
  request: PermissionRequest,
): request is PermissionRequest & { toolName: "channel_action"; input: object } {
  return request.toolName === "channel_action" && typeof request.input === "object" && request.input !== null;
}

function isChannelStorePermissionRequest(
  request: PermissionRequest,
): request is PermissionRequest & { toolName: "channel_store"; input: object } {
  return request.toolName === "channel_store" && typeof request.input === "object" && request.input !== null;
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

function isBlockedInReadOnlySandbox(toolName: string): boolean {
  return toolName === "bash" || toolName === "write" || toolName === "edit";
}

function requireSupportedSandboxMode(mode: SandboxMode): Extract<SandboxMode, "read-only" | "danger-full-access"> {
  if (mode === "workspace-write") {
    throw new Error("Sandbox mode workspace-write is not implemented yet.");
  }

  return mode;
}
