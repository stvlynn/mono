import { createAutoRepairingBashTool } from "./bash-auto-repair.js";
import type { AgentTool, ApprovalRequest } from "@mono/shared";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { DefaultPermissionPolicy, wrapToolWithPermissions, type WrappedToolOptions } from "./permission.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export * from "./artifact-store.js";
export * from "./bash-auto-repair.js";
export * from "./bash.js";
export * from "./edit.js";
export * from "./permission.js";
export * from "./read.js";
export { createChannelActionTool } from "./telegram-action.js";
export { createChannelStoreTool } from "./telegram-sticker-store.js";
export * from "./utils.js";
export * from "./write.js";

export function createCodingTools(cwd: string): AgentTool[] {
  return [createReadTool(cwd), createWriteTool(cwd), createEditTool(cwd), createBashTool(cwd)];
}

type ProtectedToolOptions = Omit<WrappedToolOptions, "cwd" | "policy"> & {
  policy?: WrappedToolOptions["policy"];
  requestInstallApproval?: (request: ApprovalRequest) => Promise<boolean>;
};

export function createProtectedBashTool(cwd: string, options: ProtectedToolOptions): AgentTool {
  const policy = options.policy ?? new DefaultPermissionPolicy();
  const {
    policy: _unusedPolicy,
    requestInstallApproval,
    ...wrappedOptions
  } = options;
  const protectedBashTool = wrapToolWithPermissions(createBashTool(cwd), {
    ...wrappedOptions,
    cwd,
    policy
  });
  const requestInstallApprovalHandler = requestInstallApproval
    ? async (request: {
      packageManager: string;
      installedPackages: string[];
    }) => {
      const approvalRequest: ApprovalRequest = {
        toolName: "bash",
        input: {
          command: `auto-repair install via ${request.packageManager}: ${request.installedPackages.join(" ")}`,
        },
        cwd,
        sessionId: wrappedOptions.sessionId,
        channel: wrappedOptions.channel,
        reason: `Auto-repair wants to install missing commands via ${request.packageManager}: ${request.installedPackages.join(", ")}`,
      };
      wrappedOptions.emit({ type: "approval-request", request: approvalRequest });
      const approved = await requestInstallApproval(approvalRequest);
      wrappedOptions.emit({
        type: "approval-result",
        toolName: "bash",
        approved,
        reason: approved ? undefined : "User denied auto-repair installation",
      });
      return approved;
    }
    : undefined;

  return createAutoRepairingBashTool(protectedBashTool, {
    requestInstallApproval: requestInstallApprovalHandler,
  });
}

export function createProtectedCodingTools(cwd: string, options: ProtectedToolOptions): AgentTool[] {
  const policy = options.policy ?? new DefaultPermissionPolicy();
  const {
    policy: _unusedPolicy,
    requestInstallApproval,
    ...wrappedOptions
  } = options;
  return [
    wrapToolWithPermissions(createReadTool(cwd), {
      ...wrappedOptions,
      cwd,
      policy,
    }),
    wrapToolWithPermissions(createWriteTool(cwd), {
      ...wrappedOptions,
      cwd,
      policy,
    }),
    wrapToolWithPermissions(createEditTool(cwd), {
      ...wrappedOptions,
      cwd,
      policy,
    }),
    createProtectedBashTool(cwd, {
      ...wrappedOptions,
      policy,
      requestInstallApproval,
    }),
  ];
}
