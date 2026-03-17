import { randomUUID } from "node:crypto";
import { resolveMonoConfig } from "@mono/config";
import {
  createBuiltInProvider,
  createDistributor,
  type InboundAction,
  inboundMessageToTaskInput,
  prepareTelegramSingleText,
} from "@mono/im-platform";
import type { Distributor, ImPlatformProvider } from "@mono/im-platform";
import {
  isTelegramSenderAllowed,
  mergeTelegramAllowFrom,
  type ApprovalRequest,
  type MonoTelegramConfig,
} from "@mono/shared";
import type {
  TelegramBotIdentity,
  TelegramChatRequest,
  TelegramControlEvent,
  TelegramCommandResult,
  TelegramIncomingMessage,
} from "./types.js";
import {
  buildTelegramApprovalActions,
  buildTelegramApprovalPrompt,
  parseTelegramApprovalActionId,
} from "./approval-buttons.js";
import { parseTelegramBotCommand } from "./bot-command.js";
import { createTelegramDraftPreviewStream } from "./draft-stream.js";
import { t } from "./language.js";
import {
  buildTelegramModelMenuResult,
  resolveTelegramUiLanguage,
  type TelegramSelectableProfile,
  TelegramModelConfigWizard,
} from "./model-config.js";
import { createNotifierFromDistributor } from "./outbound.js";
import { readTelegramAllowFromStore } from "./pairing-store.js";
import { processTelegramIncomingMessage } from "./inbound.js";

const TELEGRAM_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

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
  language_code?: string;
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
  sticker?: { file_id?: string; is_animated?: boolean; is_video?: boolean };
}

interface TelegramApiUpdate {
  update_id: number;
  message?: TelegramApiMessage;
  callback_query?: {
    id: string;
  };
}

interface PendingTelegramApproval {
  approvalId: string;
  chatId: string;
  senderId: string;
  timeout: NodeJS.Timeout;
  resolve: (approved: boolean) => void;
  settled: boolean;
  messageId?: string;
}

interface PendingTelegramProfileApply {
  profileName: string;
  chatId: string;
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
  readonly #applyProfile?: (profileName: string) => Promise<void>;
  readonly #listConfiguredProfiles?: () => Promise<TelegramSelectableProfile[]>;
  readonly #isAgentBusy?: () => boolean;
  readonly #fetchImpl: typeof fetch;
  readonly #pendingApprovals = new Map<string, PendingTelegramApproval>();
  readonly #modelConfigWizard: TelegramModelConfigWizard;
  readonly #inFlightChatHandoffs = new Set<Promise<void>>();
  #pendingProfileApply?: PendingTelegramProfileApply;

  constructor(options: {
    cwd?: string;
    onEvent?: (event: TelegramControlEvent) => void;
    onChatMessage?: (request: TelegramChatRequest) => Promise<string | null>;
    applyProfile?: (profileName: string) => Promise<void>;
    listConfiguredProfiles?: () => Promise<TelegramSelectableProfile[]>;
    isAgentBusy?: () => boolean;
    fetchImpl?: typeof fetch;
  } = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#onEvent = options.onEvent;
    this.#onChatMessage = options.onChatMessage;
    this.#applyProfile = options.applyProfile;
    this.#listConfiguredProfiles = options.listConfiguredProfiles;
    this.#isAgentBusy = options.isAgentBusy;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#modelConfigWizard = new TelegramModelConfigWizard({
      cwd: this.#cwd,
      listConfiguredProfiles: this.#listConfiguredProfiles,
    });
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
      fetchImpl: this.#fetchImpl,
    });
    this.#distributor = createDistributor({
      providers: [this.#provider],
    });
    this.#botIdentity = await this.#fetchBotIdentity();
    await this.#syncCommandMenu();
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
    this.#clearPendingApprovals(false);
    this.#abortController = undefined;
    this.#provider = undefined;
    this.#emit({ type: "stopped", message: "Telegram runtime stopped." });
  }

  async flushPendingProfileApplication(): Promise<void> {
    const pending = this.#pendingProfileApply;
    if (!pending || !this.#applyProfile || this.#isAgentBusy?.()) {
      return;
    }

    this.#pendingProfileApply = undefined;
    try {
      await this.#applyProfile(pending.profileName);
      this.#emit({
        type: "config-updated",
        message: `Applied Telegram model profile ${pending.profileName}.`,
      });

      if (this.#distributor) {
        const notifier = createNotifierFromDistributor(this.#distributor);
        await notifier.sendText(
          pending.chatId,
          `Telegram model configuration is now active.\n\nProfile: ${pending.profileName}`,
        ).catch(() => {});
      }
    } catch (error) {
      const formatted = formatTelegramRuntimeError(error);
      this.#emit({
        type: "error",
        message: `Saved Telegram model profile but failed to apply it automatically: ${formatted}`,
      });
      if (this.#distributor) {
        const notifier = createNotifierFromDistributor(this.#distributor);
        await notifier.sendText(
          pending.chatId,
          `Saved the Telegram model profile, but automatic apply failed.\n\n${formatted}`,
        ).catch(() => {});
      }
    }
  }

  async requestApproval(request: ApprovalRequest): Promise<boolean | null> {
    if (!this.canHandleTelegramApproval(request)) {
      return null;
    }

    const chatId = request.channel.id;
    const approvalId = this.#allocateApprovalId();

    return new Promise<boolean>((resolve, reject) => {
      const pending = this.createPendingApproval(approvalId, chatId, resolve);
      this.#pendingApprovals.set(approvalId, pending);

      void this.sendApprovalPrompt(pending, request).catch((error) => {
        this.clearPendingApproval(pending);
        reject(error);
      });
    });
  }

  async #pollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const updates = await this.#callTelegram<TelegramApiUpdate[]>("getUpdates", {
          offset: this.#offset,
          timeout: this.#config?.pollingTimeoutSeconds ?? 20,
          allowed_updates: ["message", "callback_query"],
        }, signal);

        for (const update of updates) {
          this.#offset = update.update_id + 1;
          if (await this.#handleIncomingAction(update)) {
            continue;
          }
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

  async #handleIncomingAction(update: TelegramApiUpdate): Promise<boolean> {
    const action = await this.#provider?.normalizeIncomingAction?.(update);
    if (!action) {
      return false;
    }

    const decision = parseTelegramApprovalActionId(action.actionId);
    if (decision) {
      const pending = this.#pendingApprovals.get(decision.approvalId);
      if (!pending) {
        await this.#answerCallbackQuery(action.interactionId, "Approval request expired.");
        return true;
      }

      if (action.sender.id !== pending.senderId) {
        await this.#answerCallbackQuery(action.interactionId, "You are not allowed to answer this request.");
        return true;
      }

      if (pending.settled) {
        await this.#answerCallbackQuery(action.interactionId, "Approval already resolved.");
        return true;
      }

      await this.#answerCallbackQuery(
        action.interactionId,
        decision.decision === "approve" ? "Approved." : "Denied."
      );
      await this.#finalizeApproval(decision.approvalId, decision.decision === "approve", action);
      return true;
    }

    const wizardResult = await this.#modelConfigWizard.handleAction({
      actionId: action.actionId,
      senderId: action.sender.id,
      chatId: String(action.target.address),
    });
    if (!wizardResult) {
      await this.#answerCallbackQuery(action.interactionId);
      return true;
    }

    await this.#answerCallbackQuery(action.interactionId, wizardResult.ok ? "Updated." : "Check the latest message.");
    await this.#dispatchTelegramResult(String(action.target.address), wizardResult);
    return true;
  }

  async #handleIncomingMessage(update: TelegramApiUpdate, message: TelegramIncomingMessage): Promise<void> {
    if (!this.#config || !this.#botIdentity || !this.#distributor) {
      return;
    }

    const authorized = await this.#isAuthorizedPrivateSender(message);
    const command = parseTelegramBotCommand(message.text, this.#botIdentity.username);
    const notifier = createNotifierFromDistributor(this.#distributor);

    if (authorized) {
      const wizardResult = await this.#maybeHandleModelConfigMessage(message, command);
      if (wizardResult) {
        await this.#dispatchTelegramResult(message.chatId, wizardResult);
        return;
      }
    }

    const result = await processTelegramIncomingMessage({
      cwd: this.#cwd,
      config: this.#config,
      botIdentity: this.#botIdentity,
      message,
      authorizedMessageMode: this.#onChatMessage ? "chat" : "control",
    });

    if (result?.handoffToChat) {
      this.#startChatHandoff(update, message, notifier);
      return;
    }
    if (!result) {
      return;
    }

    await this.#dispatchTelegramResult(message.chatId, result);
  }

  async #dispatchTelegramResult(chatId: string, result: TelegramCommandResult): Promise<void> {
    if (!this.#distributor) {
      return;
    }

    const notifier = createNotifierFromDistributor(this.#distributor);
    if (result.lines.length > 0 || result.actions?.length) {
      await notifier.sendText(
        chatId,
        result.lines.join("\n"),
        result.actions?.length ? { actions: result.actions } : undefined,
      );
    }

    if (result.title.includes("Pairing")) {
      this.#emit({ type: "pairing-request", message: result.status });
      return;
    }

    if (result.title.includes("Approved")) {
      this.#emit({ type: "pairing-approved", message: result.status });
      return;
    }

    const wizardResult = result as TelegramCommandResult & {
      configuredProfileName?: string;
      removedProfileName?: string;
      deleteSourceMessageId?: number;
    };
    if (wizardResult.deleteSourceMessageId) {
      const deleted = await this.#deleteMessage(chatId, wizardResult.deleteSourceMessageId);
      if (!deleted) {
        await notifier.sendText(
          chatId,
          "Saved the API key locally, but Telegram did not let mono delete the original API key message. Please delete it manually.",
        ).catch(() => {});
      }
    }

    if (wizardResult.configuredProfileName) {
      await this.#handleConfiguredProfile(chatId, wizardResult.configuredProfileName, notifier);
      return;
    }

    if (wizardResult.removedProfileName) {
      this.#emit({
        type: "config-updated",
        message: `Removed Telegram profile ${wizardResult.removedProfileName}.`,
      });
    }
  }

  async #maybeHandleModelConfigMessage(
    message: TelegramIncomingMessage,
    command: ReturnType<typeof parseTelegramBotCommand>,
  ): Promise<TelegramCommandResult | null> {
    if (message.chatType !== "private") {
      return null;
    }

    const senderId = message.senderId ?? message.chatId;
    if (command?.name === "model") {
      return buildTelegramModelMenuResult(await resolveTelegramUiLanguage({
        cwd: this.#cwd,
        senderId,
        languageCode: message.languageCode,
      }));
    }

    if (command?.name === "cancel") {
      return (await this.#modelConfigWizard.cancel(senderId)) ?? {
        ok: true,
        title: "Telegram Model Setup",
        lines: ["No Telegram model configuration wizard is active."],
        status: "No Telegram model configuration in progress",
      };
    }

    if (command) {
      return null;
    }

    if (!await this.#modelConfigWizard.hasActiveSession(senderId)) {
      return null;
    }

    return this.#modelConfigWizard.handleText(message);
  }

  async #isAuthorizedPrivateSender(message: TelegramIncomingMessage): Promise<boolean> {
    if (!this.#config || message.chatType !== "private") {
      return false;
    }

    const storeAllowFrom = await readTelegramAllowFromStore(this.#cwd);
    const effectiveAllowFrom = mergeTelegramAllowFrom(this.#config, storeAllowFrom);
    return isTelegramSenderAllowed(message.senderId, effectiveAllowFrom);
  }

  async #handleConfiguredProfile(
    chatId: string,
    profileName: string,
    notifier: ReturnType<typeof createNotifierFromDistributor>,
  ): Promise<void> {
    if (!this.#applyProfile) {
      this.#emit({
        type: "config-updated",
        message: `Saved Telegram model profile ${profileName}.`,
      });
      return;
    }

    if (this.#isAgentBusy?.()) {
      this.#pendingProfileApply = { profileName, chatId };
      this.#emit({
        type: "warning",
        message: `Saved Telegram model profile ${profileName}. It will apply after the current task finishes.`,
      });
      await notifier.sendText(
        chatId,
        `Saved ${profileName} and queued it for application after the current task finishes.`,
      ).catch(() => {});
      return;
    }

    try {
      await this.#applyProfile(profileName);
      this.#emit({
        type: "config-updated",
        message: `Saved and applied Telegram model profile ${profileName}.`,
      });
      await notifier.sendText(
        chatId,
        `Applied Telegram model profile immediately.\n\nProfile: ${profileName}`,
      ).catch(() => {});
    } catch (error) {
      const formatted = formatTelegramRuntimeError(error);
      this.#emit({
        type: "error",
        message: `Saved Telegram model profile but failed to apply it immediately: ${formatted}`,
      });
      await notifier.sendText(
        chatId,
        `Saved the Telegram model profile, but immediate apply failed.\n\n${formatted}`,
      ).catch(() => {});
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
        const unsupportedNotice = resolveUnsupportedTelegramMediaNotice(update.message);
        if (unsupportedNotice) {
          await notifier.sendText(message.chatId, unsupportedNotice).catch(() => {});
        }
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

  #startChatHandoff(
    update: TelegramApiUpdate,
    message: TelegramIncomingMessage,
    notifier: ReturnType<typeof createNotifierFromDistributor>,
  ): void {
    const handoff = this.#handleChatHandoff(update, message, notifier).finally(() => {
      this.#inFlightChatHandoffs.delete(handoff);
    });
    this.#inFlightChatHandoffs.add(handoff);
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

  async #syncCommandMenu(): Promise<void> {
    try {
      await this.#callTelegram("setMyCommands", {
        commands: [
          { command: "help", description: t("en", "command_help_description") },
          { command: "model", description: t("en", "command_model_description") },
          { command: "cancel", description: t("en", "command_cancel_description") },
        ],
      });
      await this.#callTelegram("setMyCommands", {
        commands: [
          { command: "help", description: t("zh", "command_help_description") },
          { command: "model", description: t("zh", "command_model_description") },
          { command: "cancel", description: t("zh", "command_cancel_description") },
        ],
        language_code: "zh",
      });
      await this.#callTelegram("setChatMenuButton", {
        menu_button: {
          type: "commands",
        },
      });
    } catch (error) {
      const formatted = formatTelegramRuntimeError(error);
      this.#emit({
        type: "warning",
        message: `Telegram command menu sync failed: ${formatted}`,
      });
    }
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
      response = await this.#fetchImpl(`https://api.telegram.org/bot${this.#token}/${method}`, {
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

  async #answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.#callTelegram("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    }).catch(() => {});
  }

  async #deleteMessage(chatId: string, messageId: number): Promise<boolean> {
    try {
      await this.#callTelegram("deleteMessage", {
        chat_id: Number(chatId),
        message_id: messageId,
      });
      return true;
    } catch {
      return false;
    }
  }

  async #finalizeApproval(
    approvalId: string,
    approved: boolean,
    action?: InboundAction,
  ): Promise<void> {
    const pending = this.#pendingApprovals.get(approvalId);
    if (!pending || pending.settled) {
      return;
    }

    pending.settled = true;
    clearTimeout(pending.timeout);
    this.#pendingApprovals.delete(approvalId);

    const messageId = pending.messageId ?? action?.remoteMessageId;
    if (messageId) {
      await this.removeApprovalButtons(pending.chatId, messageId);
    }

    pending.resolve(approved);
  }

  #clearPendingApprovals(approved: boolean): void {
    for (const pending of this.#pendingApprovals.values()) {
      clearTimeout(pending.timeout);
      if (!pending.settled) {
        pending.settled = true;
        pending.resolve(approved);
      }
    }
    this.#pendingApprovals.clear();
  }

  #allocateApprovalId(): string {
    return randomUUID();
  }

  private canHandleTelegramApproval(request: ApprovalRequest): request is ApprovalRequest & {
    channel: { platform: "telegram"; kind: "dm"; id: string };
  } {
    return Boolean(this.#distributor)
      && request.channel?.platform === "telegram"
      && request.channel.kind === "dm";
  }

  private createPendingApproval(
    approvalId: string,
    chatId: string,
    resolve: (approved: boolean) => void,
  ): PendingTelegramApproval {
    const timeout = setTimeout(() => {
      this.#finalizeApproval(approvalId, false).catch(() => {});
    }, TELEGRAM_APPROVAL_TIMEOUT_MS);

    return {
      approvalId,
      chatId,
      senderId: chatId,
      timeout,
      resolve,
      settled: false,
    };
  }

  private async sendApprovalPrompt(
    pending: PendingTelegramApproval,
    request: ApprovalRequest,
  ): Promise<void> {
    const result = await this.#distributor!.dispatch({
      provider: "telegram-control",
      target: {
        kind: "dm",
        address: pending.chatId,
      },
      content: {
        type: "text",
        text: buildTelegramApprovalPrompt(request),
        format: "plain",
      },
      options: {
        actions: buildTelegramApprovalActions(pending.approvalId),
      },
    });
    pending.messageId = result.remoteMessageIds[0];
  }

  private clearPendingApproval(pending: PendingTelegramApproval): void {
    clearTimeout(pending.timeout);
    this.#pendingApprovals.delete(pending.approvalId);
  }

  private async removeApprovalButtons(chatId: string, messageId: string): Promise<void> {
    await this.#callTelegram("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: Number(messageId),
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
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
    languageCode: message.from?.language_code,
    text: message.text ?? message.caption,
  };
}

function resolveUnsupportedTelegramMediaNotice(message: TelegramApiMessage | undefined): string | undefined {
  if (!message?.sticker) {
    return undefined;
  }

  if (message.sticker.is_animated || message.sticker.is_video) {
    return "Animated and video stickers are not supported yet. Please send a static sticker or image.";
  }

  return undefined;
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
