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
  summary: string;
  detail?: string;
  argsText?: string;
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
  ctrlCPressedOnce?: boolean;
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
  kind:
    | "model"
    | "profile"
    | "session"
    | "skill"
    | "memory"
    | "tree"
    | "settings"
    | "theme"
    | "connect-provider"
    | "connect-model"
    | "connect-interface";
  items: ListDialogItem[];
  initialFilter?: string;
  hint?: string;
  onSelect: (value: string) => void | Promise<void>;
}

export interface InputDialog extends BaseDialog {
  type: "input";
  kind: "connect-key";
  label: string;
  hint?: string;
  initialValue?: string;
  placeholder?: string;
  secret?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
}

export type DialogInstance = HelpDialog | InfoDialog | ApprovalDialog | ListDialog | InputDialog;

export interface UISettings {
  cleanUiDetailsVisible: boolean;
  footerVisible: boolean;
  alternateBuffer: boolean;
  shortcutsHint: boolean;
  assistantMarkdownEnabled: boolean;
  thinkingVisible: boolean;
  toolDetailsVisible: boolean;
}

export interface UIState {
  initialized: boolean;
  startupState: "idle" | "initializing" | "ready" | "init_failed";
  running: boolean;
  isExiting: boolean;
  status: string;
  fatalError?: string;
  waitingCopy?: UIWaitingCopy;
  interrupt: InterruptState;
  history: UIHistoryItem[];
  historyScrollOffset: number;
  pendingAssistant: UIPendingAssistant | null;
  pendingTools: UIToolCall[];
  dialogs: DialogInstance[];
  toasts: UIToast[];
  currentTask?: TaskState;
  currentTodoRecord?: TaskTodoRecord;
  currentPrompt?: string;
}
