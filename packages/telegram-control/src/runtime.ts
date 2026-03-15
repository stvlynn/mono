import { resolveMonoConfig } from "@mono/config";
import {
  createBuiltInProvider,
  createDistributor,
  inboundMessageToTaskInput,
  prepareTelegramSingleText,
} from "@mono/im-platform";
import type { Distributor, ImPlatformProvider } from "@mono/im-platform";
import type { MonoTelegramConfig } from "@mono/shared";
import type {
  TelegramBotIdentity,
  TelegramChatRequest,
  TelegramControlEvent,
  TelegramIncomingMessage,
} from "./types.js";
import { createTelegramDraftPreviewStream } from "./draft-stream.js";
import { createNotifierFromDistributor } from "./outbound.js";
import { processTelegramIncomingMessage } from "./inbound.js";

interface TelegramUpdateResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramApiChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

interface TelegramApiUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramApiMessage {
  message_id: number;
  chat: TelegramApiChat;
  message_thread_id?: number;
  from?: TelegramApiUser;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id?: string }>;
  document?: { file_id?: string; mime_type?: string; file_name?: string };
}

interface TelegramApiUpdate {
  update_id: number;
  message?: TelegramApiMessage;
}

export class TelegramControlRuntime {
  readonly #cwd: string;
  readonly #onEvent?: (event: TelegramControlEvent) => void;
  #abortController?: AbortController;
  #loopPromise?: Promise<void>;
  #offset = 0;
  #config?: MonoTelegramConfig;
  #botIdentity?: TelegramBotIdentity;
  #distributor?: Distributor;
  #provider?: ImPlatformProvider;
  #token?: string;
  readonly #onChatMessage?: (request: TelegramChatRequest) => Promise<string | null>;

  constructor(options: {
    cwd?: string;
    onEvent?: (event: TelegramControlEvent) => void;
    onChatMessage?: (request: TelegramChatRequest) => Promise<string | null>;
  } = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#onEvent = options.onEvent;
    this.#onChatMessage = options.onChatMessage;
  }

  async start(): Promise<void> {
    if (this.#loopPromise) {
      return;
    }

    const resolved = await resolveMonoConfig({ cwd: this.#cwd });
    const telegram = resolved.channels.telegram;
    if (!telegram.enabled || !telegram.botToken) {
      this.#emit({ type: "stopped", message: "Telegram runtime is disabled." });
      return;
    }

    this.#config = telegram;
    this.#token = telegram.botToken;
    this.#provider = createBuiltInProvider({
      platform: "telegram",
      id: "telegram-control",
      botToken: telegram.botToken,
      defaultTextFormat: "markdown",
    });
    this.#distributor = createDistributor({
      providers: [this.#provider],
    });
    this.#botIdentity = await this.#fetchBotIdentity();
    this.#abortController = new AbortController();
    this.#loopPromise = this.#pollLoop(this.#abortController.signal).finally(() => {
      this.#loopPromise = undefined;
    });
    this.#emit({
      type: "started",
      message: `Telegram runtime started${this.#botIdentity.username ? ` as @${this.#botIdentity.username}` : ""}.`,
    });
  }

  async reload(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.#abortController?.abort();
    if (this.#loopPromise) {
      await this.#loopPromise.catch(() => {});
    }
    this.#abortController = undefined;
    this.#provider = undefined;
    this.#emit({ type: "stopped", message: "Telegram runtime stopped." });
  }

  async #pollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const updates = await this.#callTelegram<TelegramApiUpdate[]>("getUpdates", {
          offset: this.#offset,
          timeout: this.#config?.pollingTimeoutSeconds ?? 20,
          allowed_updates: ["message"],
        }, signal);

        for (const update of updates) {
          this.#offset = update.update_id + 1;
          const message = toIncomingMessage(update.message);
          if (!message) {
            continue;
          }
          await this.#handleIncomingMessage(update, message);
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        if (isTelegramPollingConflict(error)) {
          this.#emit({
            type: "warning",
            message: "Telegram polling stopped: another bot instance is already using getUpdates for this token.",
          });
          return;
        }
        const message = formatTelegramRuntimeError(error);
        this.#emit({ type: "error", message: `Telegram polling failed: ${message}` });
        await wait(1500, signal).catch(() => {});
      }
    }
  }

  async #handleIncomingMessage(update: TelegramApiUpdate, message: TelegramIncomingMessage): Promise<void> {
    if (!this.#config || !this.#botIdentity || !this.#distributor) {
      return;
    }

    const result = await processTelegramIncomingMessage({
      cwd: this.#cwd,
      config: this.#config,
      botIdentity: this.#botIdentity,
      message,
      authorizedMessageMode: this.#onChatMessage ? "chat" : "control",
    });

    const notifier = createNotifierFromDistributor(this.#distributor);
    if (result?.handoffToChat) {
      await this.#handleChatHandoff(update, message, notifier);
      return;
    }
    if (!result) {
      return;
    }

    await notifier.sendText(message.chatId, result.lines.join("\n"));

    if (result.title.includes("Pairing")) {
      this.#emit({ type: "pairing-request", message: result.status });
      return;
    }

    if (result.title.includes("Approved")) {
      this.#emit({ type: "pairing-approved", message: result.status });
    }
  }

  async #handleChatHandoff(
    update: TelegramApiUpdate,
    message: TelegramIncomingMessage,
    notifier: ReturnType<typeof createNotifierFromDistributor>,
  ): Promise<void> {
    if (!this.#onChatMessage || !this.#provider?.normalizeIncomingMessage) {
      return;
    }

    const preview = this.#createReplyPreview(message);
    try {
      const inbound = await this.#provider.normalizeIncomingMessage(update);
      if (!inbound) {
        return;
      }

      const reply = await this.#onChatMessage({
        input: inboundMessageToTaskInput(inbound),
        message,
        preview: preview ? { update: (text) => preview.update(text) } : undefined,
      });
      if (!reply?.trim()) {
        await preview?.clear();
        return;
      }

      const materialized = await preview?.materialize(reply);
      if (!materialized) {
        await notifier.sendText(message.chatId, reply);
        await preview?.clear();
      }
    } catch (error) {
      await preview?.clear().catch(() => {});
      const formatted = formatTelegramRuntimeError(error);
      this.#emit({ type: "error", message: `Telegram chat handling failed: ${formatted}` });
      await notifier.sendText(message.chatId, `Request failed: ${formatted}`).catch(() => {});
    }
  }

  #createReplyPreview(message: TelegramIncomingMessage) {
    if (message.chatType !== "private") {
      return undefined;
    }

    const chatId = Number(message.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) {
      return undefined;
    }

    return createTelegramDraftPreviewStream({
      renderText: (text) => prepareTelegramSingleText(text, "markdown", "markdown"),
      sendDraft: async (draftId, text, parseMode) => {
        await this.#callTelegram("sendMessageDraft", {
          chat_id: chatId,
          draft_id: draftId,
          text,
          ...(parseMode ? { parse_mode: parseMode } : {}),
        });
      },
      sendFinal: async (text, parseMode) => {
        const result = await this.#callTelegram<{ message_id?: number }>("sendMessage", {
          chat_id: chatId,
          text,
          ...(parseMode ? { parse_mode: parseMode } : {}),
        });
        return typeof result.message_id === "number" ? result.message_id : undefined;
      },
    });
  }

  async #fetchBotIdentity(): Promise<TelegramBotIdentity> {
    const result = await this.#callTelegram<{
      id: number;
      username?: string;
      first_name?: string;
    }>("getMe", {});

    return {
      id: String(result.id),
      username: result.username,
      displayName: result.first_name,
    };
  }

  async #callTelegram<Result>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Result> {
    if (!this.#token) {
      throw new Error("Telegram runtime token is not configured");
    }

    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new Error(`Telegram ${method} request failed`, {
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
    const payload = (await response.json()) as TelegramUpdateResponse<Result>;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.description ?? response.statusText);
    }
    return payload.result;
  }

  #emit(event: TelegramControlEvent): void {
    this.#onEvent?.(event);
  }
}

function toIncomingMessage(message: TelegramApiMessage | undefined): TelegramIncomingMessage | null {
  if (!message) {
    return null;
  }
  if (message.chat.type !== "private" && message.chat.type !== "group" && message.chat.type !== "supergroup") {
    return null;
  }

  const displayName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    messageId: message.message_id,
    chatId: String(message.chat.id),
    chatType: message.chat.type,
    senderId: message.from?.id != null ? String(message.from.id) : undefined,
    username: message.from?.username,
    displayName: displayName || message.from?.username,
    text: message.text,
  };
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function formatTelegramRuntimeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause;
  if (!(cause instanceof Error)) {
    return error.message;
  }

  if (!cause.message || cause.message === error.message) {
    return error.message;
  }

  return `${error.message}: ${cause.message}`;
}

export function isTelegramPollingConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = [error.message, error.cause instanceof Error ? error.cause.message : ""].join(" ").toLowerCase();
  return message.includes("terminated by other getupdates request");
}
