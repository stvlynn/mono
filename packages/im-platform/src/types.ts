import type { InputImageAttachment, TaskInput } from "@mono/shared";

export type DispatchTargetKind = "channel" | "dm";
export type DispatchTextFormat = "plain" | "markdown" | "html";
export type DispatchDeliveryMode = "immediate" | "native-draft";
export type DispatchContentType = "text" | "photo" | "video" | "document" | "media-group";
export type DispatchActionStyle = "default" | "primary" | "danger";

export interface DispatchBinaryFile {
  filename: string;
  data: Uint8Array | ArrayBuffer;
  mimeType?: string;
}

export type DispatchMediaSource = string | DispatchBinaryFile;

export interface DispatchTarget {
  kind: DispatchTargetKind;
  address: string | number;
  topicId?: number;
}

export interface DispatchAction {
  id: string;
  label: string;
  style?: DispatchActionStyle;
}

export type DispatchActionRow = DispatchAction[];

export interface DispatchOptions {
  silent?: boolean;
  protectContent?: boolean;
  allowPaidBroadcast?: boolean;
  deliveryMode?: DispatchDeliveryMode;
  actions?: DispatchActionRow[];
}

export interface TextDispatchContent {
  type: "text";
  text: string;
  format?: DispatchTextFormat;
}

export interface PhotoDispatchContent {
  type: "photo";
  source: DispatchMediaSource;
  caption?: string;
  format?: DispatchTextFormat;
  hasSpoiler?: boolean;
}

export interface VideoDispatchContent {
  type: "video";
  source: DispatchMediaSource;
  caption?: string;
  format?: DispatchTextFormat;
}

export interface DocumentDispatchContent {
  type: "document";
  source: DispatchMediaSource;
  caption?: string;
  format?: DispatchTextFormat;
}

export interface MediaGroupDispatchItem {
  type: "photo" | "video" | "document";
  source: DispatchMediaSource;
  caption?: string;
  format?: DispatchTextFormat;
  hasSpoiler?: boolean;
}

export interface MediaGroupDispatchContent {
  type: "media-group";
  items: MediaGroupDispatchItem[];
}

export type DispatchContent =
  | TextDispatchContent
  | PhotoDispatchContent
  | VideoDispatchContent
  | DocumentDispatchContent
  | MediaGroupDispatchContent;

export interface DispatchRequest {
  provider: string;
  target: DispatchTarget;
  content: DispatchContent;
  options?: DispatchOptions;
}

export interface DispatchResult {
  provider: string;
  platform: string;
  remoteChatId: string;
  remoteMessageIds: string[];
  raw?: unknown;
}

export interface InboundMessageSender {
  id: string;
  username?: string;
  displayName?: string;
}

export interface InboundMessage {
  provider: string;
  platform: string;
  sender: InboundMessageSender;
  target: DispatchTarget;
  text: string;
  attachments: InputImageAttachment[];
  raw?: unknown;
}

export interface InboundAction {
  provider: string;
  platform: string;
  interactionId: string;
  actionId: string;
  sender: InboundMessageSender;
  target: DispatchTarget;
  remoteMessageId?: string;
  raw?: unknown;
}

export interface ImPlatformProvider {
  readonly id: string;
  readonly platform: string;
  supportsTarget(target: DispatchTarget): boolean;
  supportsContent(content: DispatchContent): boolean;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
  normalizeIncomingMessage?(payload: unknown): Promise<InboundMessage | null>;
  normalizeIncomingAction?(payload: unknown): Promise<InboundAction | null>;
}

export function inboundMessageToTaskInput(message: InboundMessage): TaskInput {
  return {
    text: message.text,
    attachments: message.attachments,
  };
}
