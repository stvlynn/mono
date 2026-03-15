import type { TaskInput } from "@mono/shared";

export interface TelegramPairingRequest {
  senderId: string;
  code: string;
  createdAt: number;
  lastSeenAt: number;
  username?: string;
  displayName?: string;
}

export interface TelegramPairingApproval {
  senderId: string;
  code?: string;
  source: "code" | "userid";
  added: boolean;
}

export interface TelegramBotIdentity {
  id: string;
  username?: string;
  displayName?: string;
}

export interface TelegramCommandResult {
  ok: boolean;
  title: string;
  lines: string[];
  status: string;
  shouldReloadRuntime?: boolean;
  handoffToChat?: boolean;
}

export interface TelegramControlEvent {
  type: "started" | "stopped" | "pairing-request" | "pairing-approved" | "warning" | "error";
  message: string;
}

export interface TelegramIncomingMessage {
  messageId: number;
  chatId: string;
  chatType: "private" | "group" | "supergroup";
  senderId?: string;
  username?: string;
  displayName?: string;
  text?: string;
}

export interface TelegramReplyPreview {
  update(text: string): void;
}

export interface TelegramChatRequest {
  input: TaskInput;
  message: TelegramIncomingMessage;
  preview?: TelegramReplyPreview;
}
