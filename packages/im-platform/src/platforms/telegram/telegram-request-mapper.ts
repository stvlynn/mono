import type {
  DispatchActionRow,
  DispatchBinaryFile,
  DispatchContent,
  DispatchMediaSource,
  DispatchOptions,
  DispatchTarget,
  MediaGroupDispatchItem,
} from "../../types.js";
import type {
  TelegramDispatchContext,
  TelegramMultipartAttachment,
  TelegramOperation,
  TelegramInlineKeyboardMarkup,
  TelegramTargetParams,
} from "./types.js";
import { prepareTelegramCaption, prepareTelegramTextChunks } from "./telegram-text.js";

export function mapTelegramDispatchRequest(context: TelegramDispatchContext): TelegramOperation[] {
  const targetParams = mapTelegramTarget(context.target);
  const optionFields = mapTelegramOptions(context.options, context.defaultDisableNotification);
  const replyMarkup = mapTelegramReplyMarkup(context.options?.actions);

  switch (context.content.type) {
    case "text": {
      const chunks = prepareTelegramTextChunks(
        context.content.text,
        context.content.format,
        context.defaultTextFormat,
      );
      return chunks.map((chunk, index) => ({
        method: "sendMessage",
        body: {
          ...targetParams,
          ...optionFields,
          text: chunk.text,
          ...(chunk.parseMode ? { parse_mode: chunk.parseMode } : {}),
          ...(replyMarkup && index === chunks.length - 1 ? { reply_markup: replyMarkup } : {}),
        },
        fallbackText: chunk.fallbackText,
      }));
    }
    case "photo":
      return [
        mapSingleMediaOperation("sendPhoto", "photo", context.content, targetParams, optionFields, context.defaultTextFormat, replyMarkup),
      ];
    case "video":
      return [
        mapSingleMediaOperation("sendVideo", "video", context.content, targetParams, optionFields, context.defaultTextFormat, replyMarkup),
      ];
    case "document":
      return [
        mapSingleMediaOperation(
          "sendDocument",
          "document",
          context.content,
          targetParams,
          optionFields,
          context.defaultTextFormat,
          replyMarkup,
        ),
      ];
    case "media-group":
      return [mapMediaGroupOperation(context.content.items, targetParams, optionFields, context.defaultTextFormat)];
  }
}

function mapTelegramTarget(target: DispatchTarget): TelegramTargetParams {
  const params: TelegramTargetParams = {
    chat_id: target.address,
  };
  if (target.kind === "dm" && target.topicId !== undefined) {
    params.direct_messages_topic_id = target.topicId;
  }
  return params;
}

function mapTelegramOptions(
  options: DispatchOptions | undefined,
  defaultDisableNotification: boolean | undefined,
): Record<string, unknown> {
  const disableNotification = options?.silent ?? defaultDisableNotification;
  return {
    ...(disableNotification !== undefined ? { disable_notification: disableNotification } : {}),
    ...(options?.protectContent !== undefined ? { protect_content: options.protectContent } : {}),
    ...(options?.allowPaidBroadcast !== undefined ? { allow_paid_broadcast: options.allowPaidBroadcast } : {}),
  };
}

function mapSingleMediaOperation(
  method: TelegramOperation["method"],
  fieldName: "photo" | "video" | "document",
  content: Extract<DispatchContent, { type: "photo" | "video" | "document" }>,
  targetParams: TelegramTargetParams,
  optionFields: Record<string, unknown>,
  defaultTextFormat: TelegramDispatchContext["defaultTextFormat"],
  replyMarkup?: TelegramInlineKeyboardMarkup,
): TelegramOperation {
  const caption = prepareTelegramCaption(content.caption, content.format, defaultTextFormat);

  if (isBinaryFile(content.source)) {
    const formData = new FormData();
    appendTelegramFields(formData, {
      ...targetParams,
      ...optionFields,
      ...(caption ? { caption: caption.text } : {}),
      ...(caption?.parseMode ? { parse_mode: caption.parseMode } : {}),
      ...(content.type === "photo" && content.hasSpoiler !== undefined ? { has_spoiler: content.hasSpoiler } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    appendBinaryAttachment(formData, fieldName, content.source);
    return { method, body: formData };
  }

  return {
    method,
    body: {
      ...targetParams,
      ...optionFields,
      [fieldName]: content.source,
      ...(caption ? { caption: caption.text } : {}),
      ...(caption?.parseMode ? { parse_mode: caption.parseMode } : {}),
      ...(content.type === "photo" && content.hasSpoiler !== undefined ? { has_spoiler: content.hasSpoiler } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    },
  };
}

function mapMediaGroupOperation(
  items: MediaGroupDispatchItem[],
  targetParams: TelegramTargetParams,
  optionFields: Record<string, unknown>,
  defaultTextFormat: TelegramDispatchContext["defaultTextFormat"],
): TelegramOperation {
  const attachments: TelegramMultipartAttachment[] = [];
  const media = items.map((item, index) => mapMediaGroupItem(item, index, attachments, defaultTextFormat));

  if (attachments.length === 0) {
    return {
      method: "sendMediaGroup",
      body: {
        ...targetParams,
        ...optionFields,
        media,
      },
      expectCollection: true,
    };
  }

  const formData = new FormData();
  appendTelegramFields(formData, {
    ...targetParams,
    ...optionFields,
  });
  formData.append("media", JSON.stringify(media));
  for (const attachment of attachments) {
    appendBinaryAttachment(formData, attachment.fieldName, attachment.file);
  }
  return {
    method: "sendMediaGroup",
    body: formData,
    expectCollection: true,
  };
}

function mapMediaGroupItem(
  item: MediaGroupDispatchItem,
  index: number,
  attachments: TelegramMultipartAttachment[],
  defaultTextFormat: TelegramDispatchContext["defaultTextFormat"],
): Record<string, unknown> {
  const caption = prepareTelegramCaption(item.caption, item.format, defaultTextFormat);
  const media = isBinaryFile(item.source) ? attachBinaryFile(index, item.source, attachments) : item.source;
  return {
    type: item.type,
    media,
    ...(caption ? { caption: caption.text } : {}),
    ...(caption?.parseMode ? { parse_mode: caption.parseMode } : {}),
    ...(item.type === "photo" && item.hasSpoiler !== undefined ? { has_spoiler: item.hasSpoiler } : {}),
  };
}

function attachBinaryFile(
  index: number,
  file: DispatchBinaryFile,
  attachments: TelegramMultipartAttachment[],
): string {
  const fieldName = `attachment_${index}`;
  attachments.push({ fieldName, file });
  return `attach://${fieldName}`;
}

function appendBinaryAttachment(formData: FormData, fieldName: string, file: DispatchBinaryFile): void {
  const bytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
  const blob = new Blob([bytes], {
    type: file.mimeType ?? "application/octet-stream",
  });
  formData.append(fieldName, blob, file.filename);
}

function appendTelegramFields(formData: FormData, payload: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      continue;
    }
    formData.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }
}

function isBinaryFile(source: DispatchMediaSource): source is DispatchBinaryFile {
  return typeof source !== "string";
}

function mapTelegramReplyMarkup(actions: DispatchActionRow[] | undefined): TelegramInlineKeyboardMarkup | undefined {
  if (!actions || actions.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: actions.map((row) =>
      row.map((action) => ({
        text: action.label,
        callback_data: action.id,
      }))
    ),
  };
}
