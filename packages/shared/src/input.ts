import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ImagePart,
  InputImageAttachment,
  TaskInput,
  TextPart,
  UnifiedModel,
  UserMessage,
  UserPart,
  UserInputOrigin,
} from "./types.js";

export const DEFAULT_INPUT_ATTACHMENT_MAX_BYTES = 5_000_000;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
};

type TextOrImagePart = TextPart | ImagePart;

export function normalizeTaskInput(input: string | TaskInput): TaskInput {
  if (typeof input === "string") {
    return { text: input };
  }

  return {
    text: input.text,
    attachments: input.attachments?.slice() ?? [],
  };
}

export function hasTaskInputContent(input: string | TaskInput): boolean {
  const normalized = normalizeTaskInput(input);
  return Boolean(normalized.text?.trim() || normalized.attachments?.length);
}

export function taskInputToUserMessage(input: string | TaskInput, timestamp = Date.now()): UserMessage {
  const normalized = normalizeTaskInput(input);
  const text = normalized.text?.trim() ?? "";
  const attachments = normalized.attachments ?? [];

  if (attachments.length === 0) {
    return {
      role: "user",
      content: text,
      timestamp,
    };
  }

  const content: UserPart[] = [];
  if (text) {
    content.push({ type: "text", text });
  }
  content.push(...attachments.map(inputAttachmentToUserPart));

  return {
    role: "user",
    content,
    timestamp,
  };
}

export function taskInputToPlainText(input: string | TaskInput): string {
  return userContentToPlainText(taskInputToUserMessage(input, 0).content);
}

export function userContentToPlainText(content: string | UserPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return partsToPlainText(content);
}

export function toolOrUserContentToPlainText(content: string | TextOrImagePart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return partsToPlainText(content);
}

export function inputAttachmentToUserPart(attachment: InputImageAttachment): ImagePart {
  return {
    type: "image",
    mimeType: attachment.mimeType,
    data: attachment.data,
  };
}

export function createInputImageAttachment(options: {
  data: string;
  mimeType: string;
  sourceLabel?: string;
  origin?: UserInputOrigin;
  maxBytes?: number;
}): InputImageAttachment {
  const mimeType = options.mimeType.trim().toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw new Error(`Unsupported attachment MIME type: ${options.mimeType}`);
  }

  const data = normalizeBase64(options.data);
  if (!isValidBase64(data)) {
    throw new Error("Attachment data is not valid base64");
  }

  const maxBytes = options.maxBytes ?? DEFAULT_INPUT_ATTACHMENT_MAX_BYTES;
  const sizeBytes = estimateBase64DecodedBytes(data);
  if (sizeBytes > maxBytes) {
    throw new Error(`Attachment exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`);
  }

  return {
    kind: "image",
    mimeType,
    data,
    sourceLabel: options.sourceLabel,
    origin: options.origin,
  };
}

export function parseDataUrlAttachment(
  dataUrl: string,
  options: { sourceLabel?: string; origin?: UserInputOrigin; maxBytes?: number } = {},
): InputImageAttachment {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Attachment data URL is invalid");
  }

  return createInputImageAttachment({
    mimeType: match[1],
    data: match[2],
    sourceLabel: options.sourceLabel,
    origin: options.origin,
    maxBytes: options.maxBytes,
  });
}

export async function readInputImageAttachmentFromPath(
  path: string,
  options: {
    cwd?: string;
    origin?: UserInputOrigin;
    maxBytes?: number;
  } = {},
): Promise<InputImageAttachment> {
  const filePath = resolveInputPath(path, options.cwd ?? process.cwd());
  const mimeType = guessImageMimeTypeFromPath(filePath);
  if (!mimeType) {
    throw new Error(`Unsupported image file: ${path}`);
  }

  const buffer = await readFile(filePath);
  return createInputImageAttachment({
    mimeType,
    data: buffer.toString("base64"),
    sourceLabel: basename(filePath),
    origin: options.origin,
    maxBytes: options.maxBytes,
  });
}

export function guessImageMimeTypeFromPath(path: string): string | undefined {
  return IMAGE_MIME_BY_EXTENSION[extname(path).toLowerCase()];
}

export function supportsImageAttachments(model: Pick<UnifiedModel, "supportsAttachments">): boolean {
  return model.supportsAttachments !== false;
}

function partsToPlainText(parts: TextOrImagePart[]): string {
  return parts.map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`)).join("\n");
}

function resolveInputPath(path: string, cwd: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("Attachment path is empty");
  }
  if (trimmed.startsWith("file://")) {
    return fileURLToPath(trimmed);
  }
  return resolve(cwd, trimmed);
}

function normalizeBase64(value: string): string {
  return value.trim().replace(/\s+/gu, "");
}

function isValidBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function estimateBase64DecodedBytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}
