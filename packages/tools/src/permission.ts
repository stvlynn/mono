import type { ApprovalRequest, AgentTool, PermissionDecision, PermissionPolicy, PermissionRequest } from "@mono/shared";

export interface WrappedToolOptions {
  cwd: string;
  sessionId: string;
  policy: PermissionPolicy;
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  emit: (event: { type: "approval-request"; request: ApprovalRequest } | { type: "approval-result"; toolName: string; approved: boolean; reason?: string }) => void;
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  evaluate(request: PermissionRequest): PermissionDecision {
    if (request.toolName === "read") {
      return { type: "allow" };
    }

    if (request.toolName === "bash" && typeof request.input === "object" && request.input !== null) {
      const command = String((request.input as { command?: string }).command ?? "");
      if (/(^|\s)(rm\s+-rf|git\s+reset\s+--hard|mkfs|dd\s+if=)/.test(command)) {
        return { type: "deny", reason: "Command matches destructive denylist" };
      }
      return { type: "ask", reason: "bash commands require confirmation by default" };
    }

    return { type: "ask", reason: `${request.toolName} requires confirmation by default` };
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
        sessionId: options.sessionId
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
