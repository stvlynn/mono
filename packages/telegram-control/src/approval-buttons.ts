import type { DispatchActionRow } from "@mono/im-platform";
import type { ApprovalRequest } from "@mono/shared";

const APPROVAL_CALLBACK_PREFIX = "approval";
const COMMAND_PREVIEW_MAX_CHARS = 280;

export type TelegramApprovalDecision = "approve" | "deny";

export function buildTelegramApprovalPrompt(request: ApprovalRequest): string {
  const command = extractCommandPreview(request);
  return [
    `Approval required for ${request.toolName}`,
    request.reason,
    command ? `Command: ${command}` : "",
    "Choose an action below.",
  ].filter(Boolean).join("\n\n");
}

export function buildTelegramApprovalActions(approvalId: string): DispatchActionRow[] {
  return [[
    {
      id: buildTelegramApprovalActionId(approvalId, "approve"),
      label: "Approve",
      style: "primary",
    },
    {
      id: buildTelegramApprovalActionId(approvalId, "deny"),
      label: "Deny",
      style: "danger",
    },
  ]];
}

export function buildTelegramApprovalActionId(
  approvalId: string,
  decision: TelegramApprovalDecision,
): string {
  return `${APPROVAL_CALLBACK_PREFIX}:${approvalId}:${decision}`;
}

export function parseTelegramApprovalActionId(
  actionId: string,
): { approvalId: string; decision: TelegramApprovalDecision } | null {
  const match = /^approval:([^:]+):(approve|deny)$/u.exec(actionId.trim());
  if (!match) {
    return null;
  }

  return {
    approvalId: match[1]!,
    decision: match[2]! as TelegramApprovalDecision,
  };
}

function extractCommandPreview(request: ApprovalRequest): string | undefined {
  if (request.toolName !== "bash" || typeof request.input !== "object" || request.input === null) {
    return undefined;
  }

  const command = String((request.input as { command?: string }).command ?? "").trim();
  if (!command) {
    return undefined;
  }

  if (command.length <= COMMAND_PREVIEW_MAX_CHARS) {
    return command;
  }

  return `${command.slice(0, COMMAND_PREVIEW_MAX_CHARS - 1)}…`;
}
