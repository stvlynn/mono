import { basename } from "node:path";
import { createInputImageAttachment, guessImageMimeTypeFromPath, type UserInputOrigin } from "@mono/shared";
import type { DispatchTarget, InboundMessage, InboundMessageSender } from "../../types.js";
import { TelegramBotApiClient } from "./telegram-bot-api-client.js";

interface TelegramFileDescriptor {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramPhotoSize extends TelegramFileDescriptor {
  width?: number;
  height?: number;
}

interface TelegramChat {
  id: number | string;
  type?: string;
  username?: string;
  title?: string;
}

interface TelegramSender {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
}

interface TelegramIncomingMessage {
  message_id: number;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  from?: TelegramSender;
  sender_chat?: TelegramSender;
  chat: TelegramChat;
  photo?: TelegramPhotoSize[];
  document?: TelegramFileDescriptor;
}

interface TelegramUpdate {
  message?: TelegramIncomingMessage;
  edited_message?: TelegramIncomingMessage;
  channel_post?: TelegramIncomingMessage;
  edited_channel_post?: TelegramIncomingMessage;
}

interface TelegramGetFileResult {
  file_path?: string;
}

export async function normalizeTelegramIncomingMessage(options: {
  providerId: string;
  platform: string;
  client: TelegramBotApiClient;
  payload: unknown;
  origin?: UserInputOrigin;
}): Promise<InboundMessage | null> {
  const message = extractIncomingMessage(options.payload);
  if (!message) {
    return null;
  }

  const attachments = await extractIncomingAttachments(options.client, message, options.origin ?? "remote_platform");
  const text = (message.text ?? message.caption ?? "").trim();
  if (!text && attachments.length === 0) {
    return null;
  }

  return {
    provider: options.providerId,
    platform: options.platform,
    sender: resolveSender(message),
    target: resolveTarget(message),
    text,
    attachments,
    raw: options.payload,
  };
}

function extractIncomingMessage(payload: unknown): TelegramIncomingMessage | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const update = payload as TelegramUpdate;
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
}

async function extractIncomingAttachments(
  client: TelegramBotApiClient,
  message: TelegramIncomingMessage,
  origin: UserInputOrigin,
) {
  const attachments = [];
  const photo = message.photo?.at(-1);
  if (photo?.file_id) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: photo.file_id,
      mimeType: "image/jpeg",
      sourceLabel: `telegram-photo-${message.message_id}.jpg`,
      origin,
    });
    if (attachment) {
      attachments.push(attachment);
    }
  }

  const document = message.document;
  if (document?.file_id && document.mime_type?.startsWith("image/")) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: document.file_id,
      mimeType: document.mime_type,
      sourceLabel: document.file_name ?? `telegram-image-${message.message_id}`,
      origin,
    });
    if (attachment) {
      attachments.push(attachment);
    }
  }

  return attachments;
}

async function downloadIncomingAttachment(
  client: TelegramBotApiClient,
  options: {
    fileId: string;
    mimeType: string;
    sourceLabel: string;
    origin: UserInputOrigin;
  },
) {
  const file = await client.call<TelegramGetFileResult>("getFile", { file_id: options.fileId });
  if (!file.file_path) {
    return null;
  }

  const bytes = await client.downloadFile(file.file_path);
  const inferredMimeType = guessImageMimeTypeFromPath(file.file_path) ?? options.mimeType;
  return createInputImageAttachment({
    mimeType: inferredMimeType,
    data: Buffer.from(bytes).toString("base64"),
    sourceLabel: options.sourceLabel || basename(file.file_path),
    origin: options.origin,
  });
}

function resolveSender(message: TelegramIncomingMessage): InboundMessageSender {
  const sender = message.from ?? message.sender_chat;
  if (!sender) {
    return {
      id: "unknown",
      displayName: "unknown",
    };
  }

  const displayName = [sender.first_name, sender.last_name].filter(Boolean).join(" ").trim() || sender.title;
  return {
    id: String(sender.id),
    username: sender.username,
    displayName: displayName || sender.username,
  };
}

function resolveTarget(message: TelegramIncomingMessage): DispatchTarget {
  return {
    kind: message.chat.type === "private" ? "dm" : "channel",
    address: message.chat.id,
    topicId: message.message_thread_id,
  };
}
