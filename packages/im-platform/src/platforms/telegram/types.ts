import type {
  DispatchBinaryFile,
  DispatchContent,
  DispatchOptions,
  DispatchTarget,
  DispatchTextFormat,
} from "../../types.js";

export interface TelegramPlatformAdapterConfig {
  platform: "telegram";
  id: string;
  botToken: string;
  apiBaseUrl?: string;
  defaultTextFormat?: DispatchTextFormat;
  defaultDisableNotification?: boolean;
  fetchImpl?: typeof fetch;
}

export interface TelegramTargetParams {
  chat_id: string | number;
  direct_messages_topic_id?: number;
}

export interface TelegramOperation {
  method: "sendMessage" | "sendPhoto" | "sendVideo" | "sendDocument" | "sendMediaGroup";
  body: FormData | Record<string, unknown>;
  fallbackText?: string;
  expectCollection?: boolean;
}

export interface TelegramMultipartAttachment {
  fieldName: string;
  file: DispatchBinaryFile;
}

export interface TelegramDispatchContext {
  target: DispatchTarget;
  content: DispatchContent;
  options?: DispatchOptions;
  defaultTextFormat?: DispatchTextFormat;
  defaultDisableNotification?: boolean;
}
