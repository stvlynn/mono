import type { TaskState, TaskTodoRecord, ConversationMessage } from "@mono/shared";

export interface UIToast {
  id: string;
  message: string;
  level: "info" | "warning" | "error" | "success";
}

export interface UIPendingAssistant {
  text: string;
  thinking: string;
}

export interface UIToolCall {
  callId: string;
  name: string;
  status: "pending" | "running" | "awaiting_approval" | "done" | "error" | "cancelled";
  output?: string;
}

export type WaitingStateKind =
  | "assistant_start"
  | "assistant_reasoning"
  | "assistant_streaming"
  | "tool_running"
  | "task_planning"
  | "task_verifying";

export interface UIWaitingCopy {
  kind: WaitingStateKind;
  message: string;
  toolName?: string;
}

export interface InterruptState {
  lastCtrlCAt?: number;
  armedAction?: "exit";
  hint?: string;
}

export type UIHistoryItem =
  | { id: string; type: "message"; message: ConversationMessage }
  | { id: string; type: "system"; text: string; tone?: "muted" | "info" | "warning" | "error" | "success" };

export interface BaseDialog {
  id: string;
  title: string;
}

export interface ListDialogItem {
  value: string;
  label: string;
  description?: string;
}

export interface HelpDialog extends BaseDialog {
  type: "help";
}

export interface InfoDialog extends BaseDialog {
  type: "info";
  body: string[];
}

export interface ApprovalDialog extends BaseDialog {
  type: "approval";
  toolName: string;
  reason: string;
  input: string;
  resolve: (approved: boolean) => void;
}

export interface ListDialog extends BaseDialog {
  type: "list";
  kind: "model" | "profile" | "session" | "memory" | "tree" | "settings" | "theme";
  items: ListDialogItem[];
  initialFilter?: string;
  hint?: string;
  onSelect: (value: string) => void | Promise<void>;
}

export type DialogInstance = HelpDialog | InfoDialog | ApprovalDialog | ListDialog;

export interface UISettings {
  cleanUiDetailsVisible: boolean;
  footerVisible: boolean;
  alternateBuffer: boolean;
  shortcutsHint: boolean;
}

export interface UIState {
  initialized: boolean;
  running: boolean;
  status: string;
  waitingCopy?: UIWaitingCopy;
  interrupt: InterruptState;
  history: UIHistoryItem[];
  pendingAssistant: UIPendingAssistant | null;
  pendingTools: UIToolCall[];
  dialogs: DialogInstance[];
  toasts: UIToast[];
  currentTask?: TaskState;
  currentTodoRecord?: TaskTodoRecord;
  currentPrompt?: string;
}
