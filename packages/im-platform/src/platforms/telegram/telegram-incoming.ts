import { basename } from "node:path";
import { createInputImageAttachment, guessImageMimeTypeFromPath, type UserInputOrigin } from "@mono/shared";
import type { TaskInputPlatformMetadata } from "@mono/shared";
import type { DispatchTarget, InboundAction, InboundMessage, InboundMessageSender } from "../../types.js";
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

interface TelegramSticker extends TelegramFileDescriptor {
  type?: string;
  width?: number;
  height?: number;
  is_animated?: boolean;
  is_video?: boolean;
  emoji?: string;
  set_name?: string;
}

interface TelegramVideo extends TelegramFileDescriptor {
  width?: number;
  height?: number;
  duration?: number;
}

interface TelegramAnimation extends TelegramFileDescriptor {
  width?: number;
  height?: number;
  duration?: number;
  thumbnail?: TelegramPhotoSize;
}

interface TelegramAudio extends TelegramFileDescriptor {
  duration?: number;
  performer?: string;
  title?: string;
}

interface TelegramVoice extends TelegramFileDescriptor {
  duration?: number;
}

interface TelegramVideoNote extends TelegramFileDescriptor {
  length?: number;
  duration?: number;
  thumbnail?: TelegramPhotoSize;
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
  sticker?: TelegramSticker;
  video?: TelegramVideo;
  animation?: TelegramAnimation;
  audio?: TelegramAudio;
  voice?: TelegramVoice;
  video_note?: TelegramVideoNote;
}

interface TelegramUpdate {
  message?: TelegramIncomingMessage;
  edited_message?: TelegramIncomingMessage;
  channel_post?: TelegramIncomingMessage;
  edited_channel_post?: TelegramIncomingMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramSender;
  data?: string;
  message?: TelegramIncomingMessage;
  inline_message_id?: string;
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
  const text = resolveIncomingText(message);
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
    metadata: resolveIncomingMetadata(message),
    raw: options.payload,
  };
}

export async function normalizeTelegramIncomingAction(options: {
  providerId: string;
  platform: string;
  payload: unknown;
}): Promise<InboundAction | null> {
  const query = extractCallbackQuery(options.payload);
  if (!query?.data || !query.message) {
    return null;
  }

  return {
    provider: options.providerId,
    platform: options.platform,
    interactionId: query.id,
    actionId: query.data,
    sender: resolveSenderFromUser(query.from),
    target: resolveTarget(query.message),
    remoteMessageId: String(query.message.message_id),
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

function extractCallbackQuery(payload: unknown): TelegramCallbackQuery | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const update = payload as TelegramUpdate;
  return update.callback_query;
}

function resolveIncomingText(message: TelegramIncomingMessage): string {
  const rawText = (message.text ?? message.caption ?? "").trim();
  const mediaPlaceholder = resolveIncomingMediaPlaceholder(message);

  if (mediaPlaceholder && rawText) {
    return `${mediaPlaceholder}\n${rawText}`;
  }

  return rawText || mediaPlaceholder;
}

function resolveIncomingMediaPlaceholder(message: TelegramIncomingMessage): string {
  if (message.sticker?.file_id) {
    return "<media:sticker>";
  }

  if (message.photo?.length || message.document?.mime_type?.startsWith("image/")) {
    return "<media:image>";
  }

  if (message.document?.file_id) {
    return "<media:document>";
  }

  return "";
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
  if (document?.file_id) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: document.file_id,
      mimeType: document.mime_type ?? "application/octet-stream",
      sourceLabel: document.file_name ?? `telegram-document-${message.message_id}`,
      origin,
    });
    if (attachment) {
      attachments.push(attachment);
    }
  }

  const sticker = message.sticker;
  if (sticker?.file_id && !sticker.is_animated && !sticker.is_video) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: sticker.file_id,
      mimeType: "image/webp",
      sourceLabel: `telegram-sticker-${message.message_id}.webp`,
      origin,
    });
    if (attachment) {
      attachments.push(attachment);
    }
  }

  const video = message.video;
  if (video?.file_id) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: video.file_id,
      mimeType: video.mime_type ?? "video/mp4",
      sourceLabel: `telegram-video-${message.message_id}.mp4`,
      origin,
    });
    if (attachment) {
      attachments.push(attachment);
    }
  }

  const animation = message.animation;
  if (animation?.file_id) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: animation.file_id,
      mimeType: animation.mime_type ?? "image/gif",
      sourceLabel: animation.file_name ?? `telegram-animation-${message.message_id}.gif`,
      origin,
    });
    if (attachment) {
      attachments.push(attachment);
    }
  }

  const audio = message.audio;
  if (audio?.file_id) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: audio.file_id,
      mimeType: audio.mime_type ?? "audio/mpeg",
      sourceLabel: audio.file_name ?? `telegram-audio-${message.message_id}`,
      origin,
    });
    if (attachment) {
      attachments.push(attachment);
    }
  }

  const voice = message.voice;
  if (voice?.file_id) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: voice.file_id,
      mimeType: voice.mime_type ?? "audio/ogg",
      sourceLabel: `telegram-voice-${message.message_id}.ogg`,
      origin,
    });
    if (attachment) {
      attachments.push(attachment);
    }
  }

  const videoNote = message.video_note;
  if (videoNote?.file_id) {
    const attachment = await downloadIncomingAttachment(client, {
      fileId: videoNote.file_id,
      mimeType: videoNote.mime_type ?? "video/mp4",
      sourceLabel: `telegram-video-note-${message.message_id}.mp4`,
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

function resolveIncomingMetadata(message: TelegramIncomingMessage): TaskInputPlatformMetadata | undefined {
  const sticker = message.sticker;
  const photo = message.photo?.at(-1);
  const document = message.document;
  const metadata: NonNullable<TaskInputPlatformMetadata["telegram"]> = {
    chatId: String(message.chat.id),
  };

  if (sticker?.file_id) {
    metadata.sticker = {
      fileId: sticker.file_id,
      fileUniqueId: sticker.file_unique_id,
      emoji: sticker.emoji,
      setName: sticker.set_name,
      type: sticker.type,
      ...(sticker.is_animated !== undefined ? { isAnimated: sticker.is_animated } : {}),
      ...(sticker.is_video !== undefined ? { isVideo: sticker.is_video } : {}),
    };
  }

  if (photo?.file_id) {
    metadata.photo = {
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      mimeType: "image/jpeg",
      messageId: message.message_id,
      caption: message.caption?.trim() || undefined,
    };
  }

  if (document?.file_id) {
    metadata.document = {
      fileId: document.file_id,
      fileUniqueId: document.file_unique_id,
      mimeType: document.mime_type,
      fileName: document.file_name,
      messageId: message.message_id,
      caption: message.caption?.trim() || undefined,
    };
  }

  return metadata.sticker || metadata.photo || metadata.document
    ? { telegram: metadata }
    : undefined;
}

function resolveSender(message: TelegramIncomingMessage): InboundMessageSender {
  const sender = message.from ?? message.sender_chat;
  return sender ? resolveSenderFromUser(sender) : {
    id: "unknown",
    displayName: "unknown",
  };
}

function resolveTarget(message: TelegramIncomingMessage): DispatchTarget {
  return {
    kind: message.chat.type === "private" ? "dm" : "channel",
    address: message.chat.id,
    topicId: message.message_thread_id,
  };
}

function resolveSenderFromUser(sender: TelegramSender): InboundMessageSender {
  const displayName = [sender.first_name, sender.last_name].filter(Boolean).join(" ").trim() || sender.title;
  return {
    id: String(sender.id),
    username: sender.username,
    displayName: displayName || sender.username,
  };
}
