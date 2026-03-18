import { randomUUID } from "node:crypto";
import { resolveMonoConfig } from "@mono/config";
import {
  createBuiltInProvider,
  createDistributor,
  type InboundAction,
  inboundMessageToTaskInput,
  prepareTelegramSingleText,
  prepareTelegramTextChunks,
} from "@mono/im-platform";
import type { Distributor, ImPlatformProvider } from "@mono/im-platform";
import {
  type ChannelActionRequest,
  type ChannelActionResult,
  type ChannelCapabilityContext,
  type ChannelCapabilityProvider,
  type ChannelContextResourceSource,
  type ChannelStoreRequest,
  type ChannelStoreResult,
  readJsonFile,
  isTelegramSenderAllowed,
  mergeTelegramAllowFrom,
  type ApprovalRequest,
  type MonoTelegramConfig,
  type TelegramActionRequest,
  type TelegramActionResult,
} from "@mono/shared";
import type {
  TelegramBotIdentity,
  TelegramChatResponse,
  TelegramChatResponseMessage,
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
import { createTelegramDraftPreviewStream, type TelegramDraftPreviewStream } from "./draft-stream.js";
import { t } from "./language.js";
import {
  buildTelegramModelMenuResult,
  resolveTelegramUiLanguage,
  type TelegramSelectableProfile,
  TelegramModelConfigWizard,
} from "./model-config.js";
import { createNotifierFromDistributor } from "./outbound.js";
import { readTelegramAllowFromStore } from "./pairing-store.js";
import {
  cacheTelegramSticker,
  cacheTelegramStickerSet,
  readTelegramStickerStore,
  resolveTelegramStickerCachePath,
  searchTelegramStickerCache,
  resolveTelegramStickerStorePath,
  summarizeTelegramStickerStore,
  upsertTelegramStickerStore,
} from "./sticker-store.js";
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

export class TelegramControlRuntime implements ChannelCapabilityProvider {
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
  readonly #onChatMessage?: (request: TelegramChatRequest) => Promise<TelegramChatResponse | string | null>;
  readonly #applyProfile?: (profileName: string) => Promise<void>;
  readonly #listConfiguredProfiles?: () => Promise<TelegramSelectableProfile[]>;
  readonly #isAgentBusy?: () => boolean;
  readonly #fetchImpl: typeof fetch;
  readonly #pendingApprovals = new Map<string, PendingTelegramApproval>();
  readonly #stickerCache = new Map<string, string[]>();
  readonly #modelConfigWizard: TelegramModelConfigWizard;
  readonly #inFlightChatHandoffs = new Set<Promise<void>>();
  #pendingProfileApply?: PendingTelegramProfileApply;

  constructor(options: {
    cwd?: string;
    onEvent?: (event: TelegramControlEvent) => void;
    onChatMessage?: (request: TelegramChatRequest) => Promise<TelegramChatResponse | string | null>;
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
    await this.#loadStickerPacks();
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
    this.#stickerCache.clear();
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

  supportsChannel(channel: { platform: string; kind: "dm" | "channel"; id: string } | undefined): boolean {
    return channel?.platform === "telegram";
  }

  listAvailableActions(channel: { platform: string; kind: "dm" | "channel"; id: string }): string[] {
    if (!this.supportsChannel(channel) || !this.#config) {
      return [];
    }

    return [
      this.#config.actions.send ? "send" : null,
      this.#config.actions.sticker ? "sticker" : null,
      this.#config.actions.edit ? "edit" : null,
      this.#config.actions.delete ? "delete" : null,
      this.#config.actions.react ? "react" : null,
    ].filter((value): value is string => value !== null);
  }

  listStoreResources(channel: { platform: string; kind: "dm" | "channel"; id: string }): string[] {
    if (!this.supportsChannel(channel) || !this.#config?.reply.stickers.enabled) {
      return [];
    }

    return ["sticker_source"];
  }

  async buildContext(
    input: { text?: string; metadata?: { telegram?: { chatId?: string; sticker?: { fileId?: string; fileUniqueId?: string; emoji?: string; setName?: string } } } },
    channel: { platform: string; kind: "dm" | "channel"; id: string },
    history: Array<{ role: string; metadata?: { telegram?: { chatId?: string; sticker?: { fileId?: string; fileUniqueId?: string; emoji?: string; setName?: string } } } }>,
  ): Promise<ChannelCapabilityContext> {
    const stickerContext = resolveTelegramStickerContext(input, history, channel.id);
    const sticker = stickerContext?.sticker;
    const actions = this.listAvailableActions(channel);
    const storeResources = this.listStoreResources(channel);
    const requestsAlternativeSticker = resolveTelegramAlternativeStickerRequest(input, stickerContext?.sticker);
    const requiredAction = resolveTelegramRequiredAction(input, actions, {
      sticker,
      source: stickerContext?.source,
    });
    const storePath = this.#config ? resolveTelegramStickerStorePath(this.#cwd, this.#config) : undefined;
    const cachePath = resolveTelegramStickerCachePath(this.#cwd);
    let storeExists = false;
    let storeReadable = true;
    let entryCount = 0;

    if (sticker?.fileId) {
      await cacheTelegramSticker(this.#cwd, {
        fileId: sticker.fileId,
        ...(sticker.fileUniqueId ? { fileUniqueId: sticker.fileUniqueId } : {}),
        ...(sticker.emoji ? { emoji: sticker.emoji } : {}),
        ...(sticker.setName ? { setName: sticker.setName } : {}),
      }).catch(() => {});
      if (requestsAlternativeSticker && sticker.setName) {
        await this.#ensureStickerSetCached(sticker.setName).catch(() => {});
      }
    }

    if (this.#config && storePath) {
      try {
        const store = await readTelegramStickerStore(this.#cwd, this.#config);
        const summary = summarizeTelegramStickerStore(storePath, store);
        entryCount = summary.entryCount ?? 0;
        storeExists = Boolean(await readJsonFile(storePath));
      } catch {
        storeReadable = false;
      }
    }

    return {
      channel: channel.platform,
      actions,
      storeResources,
      ...(sticker?.fileId
        ? {
          currentResource: {
            kind: "sticker",
            available: true,
            source: stickerContext?.source,
            attributes: {
              fileId: sticker.fileId,
              ...(sticker.fileUniqueId ? { fileUniqueId: sticker.fileUniqueId } : {}),
              ...(sticker.emoji ? { emoji: sticker.emoji } : {}),
              ...(sticker.setName ? { setName: sticker.setName } : {}),
            },
          },
          ...(requestsAlternativeSticker
            ? {}
            : {
              recommendedAction: {
                action: "sticker",
                targetId: channel.id,
                payload: {
                  fileId: sticker.fileId,
                  ...(sticker.emoji ? { emoji: sticker.emoji } : {}),
                },
              },
            }),
        }
        : {
          currentResource: {
            kind: "sticker",
            available: false,
          },
        }),
      ...(requiredAction
        ? {
          requiredAction,
        }
        : {}),
      ...(storeResources.length > 0
        ? {
          store: {
            resource: "sticker_source",
            path: storePath,
            exists: storeExists,
            readable: storeReadable,
            entryCount,
            searchSupported: true,
          },
        }
        : {}),
      notes: [
        ...(stickerContext?.source === "recent_history"
          ? ["The current sticker source was recovered from recent user history in this conversation."]
          : []),
        ...(requestsAlternativeSticker && sticker?.setName
          ? [`Use channel_store(resource="sticker_source", action="search", entry={ setName: "${sticker.setName}", excludeFileId: "${sticker.fileId}" }) to find another sticker from the same set before calling channel_action.`]
          : []),
        ...(requestsAlternativeSticker
          ? [`Sticker catalog search reads from ${cachePath}.`]
          : []),
      ],
    };
  }

  async executeAction(
    request: ChannelActionRequest,
    context: { channel: { platform: string; kind: "dm" | "channel"; id: string } },
  ): Promise<ChannelActionResult> {
    if (!this.supportsChannel(context.channel)) {
      return {
        ok: false,
        channel: request.channel?.trim() || context.channel.platform,
        action: request.action,
        targetId: request.targetId?.trim() || context.channel.id,
        reason: "unsupported_channel",
      };
    }

    const payload = request.payload ?? {};
    if (!isSupportedTelegramChannelAction(request.action)) {
      return {
        ok: false,
        channel: "telegram",
        action: request.action,
        targetId: request.targetId?.trim() || context.channel.id,
        reason: "unsupported_channel_action",
      };
    }
    const telegramResult = await this.executeTelegramAction({
      action: request.action as TelegramActionRequest["action"],
      chatId: request.targetId?.trim() || context.channel.id,
      messageId: toOptionalNumber(request.messageId),
      replyToMessageId: toOptionalNumber(request.replyToMessageId),
      messageThreadId: toOptionalNumber(request.threadId),
      text: typeof payload.text === "string" ? payload.text : undefined,
      format: payload.format === "plain" || payload.format === "markdown" ? payload.format : undefined,
      fileId: typeof payload.fileId === "string" ? payload.fileId : undefined,
      emoji: typeof payload.emoji === "string" ? payload.emoji : undefined,
      remove: typeof payload.remove === "boolean" ? payload.remove : undefined,
    });

    return {
      ok: telegramResult.ok,
      channel: "telegram",
      action: telegramResult.action,
      targetId: telegramResult.chatId,
      ...(telegramResult.messageId ? { messageId: telegramResult.messageId } : {}),
      ...(telegramResult.messageIds ? { messageIds: telegramResult.messageIds } : {}),
      ...(telegramResult.reason ? { reason: telegramResult.reason } : {}),
    };
  }

  async executeStore(
    request: ChannelStoreRequest,
    context: { channel: { platform: string; kind: "dm" | "channel"; id: string } },
  ): Promise<ChannelStoreResult> {
    if (!this.supportsChannel(context.channel) || request.resource !== "sticker_source" || !this.#config) {
      return {
        ok: false,
        channel: request.channel?.trim() || context.channel.platform,
        resource: request.resource,
        action: request.action,
        reason: "unsupported_channel_resource",
      };
    }

    const path = resolveTelegramStickerStorePath(this.#cwd, this.#config);
    if (request.action === "list") {
      const store = await readTelegramStickerStore(this.#cwd, this.#config);
      const summary = summarizeTelegramStickerStore(path, store);
      return {
        ok: true,
        channel: "telegram",
        resource: "sticker_source",
        action: "list",
        path: summary.path,
        entryCount: summary.entryCount,
      };
    }

    if (request.action === "search") {
      const entry = request.entry ?? {};
      const setName = typeof entry.setName === "string" ? entry.setName.trim() : "";
      if (setName) {
        await this.#ensureStickerSetCached(setName);
      }
      const results = await searchTelegramStickerCache(this.#cwd, {
        query: typeof entry.query === "string" ? entry.query : undefined,
        setName: setName || undefined,
        limit: typeof entry.limit === "number" ? entry.limit : undefined,
        excludeFileId: typeof entry.excludeFileId === "string" ? entry.excludeFileId : undefined,
      });
      return {
        ok: true,
        channel: "telegram",
        resource: "sticker_source",
        action: "search",
        path: resolveTelegramStickerCachePath(this.#cwd),
        count: results.length,
        items: results.map((sticker) => ({
          fileId: sticker.fileId,
          ...(sticker.emoji ? { emoji: sticker.emoji } : {}),
          ...(sticker.setName ? { setName: sticker.setName } : {}),
          ...(sticker.description ? { description: sticker.description } : {}),
        })),
      };
    }

    const entry = request.entry ?? {};
    const store = await upsertTelegramStickerStore(this.#cwd, this.#config, {
      packId: typeof entry.packId === "string" ? entry.packId : undefined,
      emoji: typeof entry.emoji === "string" ? entry.emoji : undefined,
      fileId: typeof entry.fileId === "string" ? entry.fileId : undefined,
      telegramSetName: typeof entry.telegramSetName === "string" ? entry.telegramSetName : undefined,
    });
    const summary = summarizeTelegramStickerStore(path, store);
    await this.#loadStickerPacks();
    return {
      ok: true,
      channel: "telegram",
      resource: "sticker_source",
      action: "upsert",
      path: summary.path,
      entryCount: summary.entryCount,
    };
  }

  async executeTelegramAction(request: TelegramActionRequest): Promise<TelegramActionResult> {
    if (!this.#config || !this.#token) {
      return {
        ok: false,
        action: request.action,
        chatId: request.chatId?.trim() ?? "",
        reason: "telegram_runtime_unavailable",
      };
    }

    const chatId = request.chatId?.trim();
    if (!chatId) {
      return {
        ok: false,
        action: request.action,
        chatId: "",
        reason: "missing_chat_id",
      };
    }

    if (!this.#isTelegramActionEnabled(request.action)) {
      return {
        ok: false,
        action: request.action,
        chatId,
        reason: "disabled",
      };
    }

    try {
      switch (request.action) {
        case "send":
          return await this.#executeSendTelegramAction(chatId, request as TelegramActionRequest & { action: "send" });
        case "sticker":
          return await this.#executeStickerTelegramAction(chatId, request as TelegramActionRequest & { action: "sticker" });
        case "edit":
          return await this.#executeEditTelegramAction(chatId, request as TelegramActionRequest & { action: "edit" });
        case "delete":
          return await this.#executeDeleteTelegramAction(chatId, request as TelegramActionRequest & { action: "delete" });
        case "react":
          return await this.#executeReactTelegramAction(chatId, request as TelegramActionRequest & { action: "react" });
      }
    } catch (error) {
      return {
        ok: false,
        action: request.action,
        chatId,
        reason: formatTelegramRuntimeError(error),
      };
    }
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
      const response = this.#normalizeChatResponse(reply);
      if (!response) {
        await preview?.clear();
        return;
      }

      await this.#deliverChatResponse(message.chatId, response, preview);
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

  #normalizeChatResponse(reply: TelegramChatResponse | string | null): TelegramChatResponse | null {
    if (typeof reply === "string") {
      const text = reply.trim();
      return text ? { messages: [{ text, format: "markdown" }] } : null;
    }

    if (!reply) {
      return null;
    }

    const messages = reply.messages
      .map((message) => ({
        ...message,
        text: message.text.trim(),
      }))
      .filter((message) => message.text);

    const stickerEmoji = reply.sticker?.emoji?.trim();
    const stickerFileId = reply.sticker?.fileId?.trim();

    if (messages.length === 0 && !stickerEmoji && !stickerFileId) {
      return null;
    }

    return {
      messages,
      ...(stickerFileId || stickerEmoji
        ? {
          sticker: {
            ...(stickerFileId ? { fileId: stickerFileId } : {}),
            ...(stickerEmoji ? { emoji: stickerEmoji } : {}),
          },
        }
        : {}),
    };
  }

  async #deliverChatResponse(
    chatId: string,
    response: TelegramChatResponse,
    preview: TelegramDraftPreviewStream | undefined,
  ): Promise<void> {
    const messages = this.#selectReplyMessagesForDelivery(response.messages);
    const [firstMessage, ...remainingMessages] = messages;

    if (firstMessage) {
      const materialized = await preview?.materialize(firstMessage.text);
      if (!materialized) {
        await this.#sendChatMessage(chatId, firstMessage);
        await preview?.clear();
      }

      for (const message of remainingMessages) {
        await this.#sendTypingAction(chatId);
        await this.#delayNextReply();
        await this.#sendChatMessage(chatId, message);
      }
    } else {
      await preview?.clear();
    }

    if (response.sticker?.fileId || response.sticker?.emoji) {
      await this.#sendSticker(chatId, response.sticker);
    }
  }

  #selectReplyMessagesForDelivery(messages: TelegramChatResponseMessage[]): TelegramChatResponseMessage[] {
    if (!this.#config?.reply.multiMessage) {
      const merged = messages
        .map((message) => message.text.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();
      return merged ? [{ text: merged, format: "markdown" }] : [];
    }

    return messages;
  }

  #isTelegramActionEnabled(action: TelegramActionRequest["action"]): boolean {
    if (!this.#config) {
      return false;
    }

    switch (action) {
      case "send":
        return this.#config.actions.send;
      case "sticker":
        return this.#config.actions.sticker;
      case "edit":
        return this.#config.actions.edit;
      case "delete":
        return this.#config.actions.delete;
      case "react":
        return this.#config.actions.react;
    }
  }

  async #executeSendTelegramAction(
    chatId: string,
    request: TelegramActionRequest & { action: "send" },
  ): Promise<TelegramActionResult> {
    const chunks = prepareTelegramTextChunks(request.text ?? "", request.format, "markdown");
    const messageIds: string[] = [];
    let threadSupported = true;

    for (const chunk of chunks) {
      const result = await this.#sendTelegramTextPayload(chatId, chunk, {
        replyToMessageId: request.replyToMessageId,
        messageThreadId: threadSupported ? request.messageThreadId : undefined,
      });
      if (!result.ok) {
        return {
          ok: false,
          action: "send",
          chatId,
          reason: result.reason,
          ...(messageIds.length > 0 ? { messageIds } : {}),
        };
      }
      if (!result.usedThread) {
        threadSupported = false;
      }
      if (result.messageId) {
        messageIds.push(result.messageId);
      }
    }

    return {
      ok: true,
      action: "send",
      chatId,
      messageId: messageIds.at(-1),
      messageIds,
    };
  }

  async #executeStickerTelegramAction(
    chatId: string,
    request: TelegramActionRequest & { action: "sticker" },
  ): Promise<TelegramActionResult> {
    const fileId = await this.#resolveStickerFileId(request);
    if (!fileId) {
      return {
        ok: false,
        action: "sticker",
        chatId,
        reason: "sticker_not_found",
      };
    }

    const payload = this.#buildTelegramThreadParams({
      replyToMessageId: request.replyToMessageId,
      messageThreadId: request.messageThreadId,
    });

    const sendSticker = async (params?: Record<string, unknown>) => this.#callTelegram<{ message_id?: number; chat?: { id?: number | string } }>(
      "sendSticker",
      {
        chat_id: chatId,
        sticker: fileId,
        ...(params ?? {}),
      },
    );

    const result = await this.#callWithThreadFallback(payload, sendSticker);
    if (!result.response) {
      return {
        ok: false,
        action: "sticker",
        chatId,
        reason: result.reason ?? "sticker_send_failed",
      };
    }

    return {
      ok: true,
      action: "sticker",
      chatId,
      messageId: String(result.response.message_id ?? ""),
    };
  }

  async #executeEditTelegramAction(
    chatId: string,
    request: TelegramActionRequest & { action: "edit" },
  ): Promise<TelegramActionResult> {
    if (!request.messageId) {
      return { ok: false, action: "edit", chatId, reason: "missing_message_id" };
    }

    const prepared = prepareTelegramSingleText(request.text ?? "", request.format, "markdown");
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: request.messageId,
      text: prepared.text,
      ...(prepared.parseMode ? { parse_mode: prepared.parseMode } : {}),
    };

    try {
      await this.#callTelegram("editMessageText", body);
    } catch (error) {
      if (!prepared.fallbackText || !isTelegramParseModeError(error)) {
        return {
          ok: false,
          action: "edit",
          chatId,
          reason: formatTelegramRuntimeError(error),
        };
      }
      await this.#callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: request.messageId,
        text: prepared.fallbackText,
      });
    }

    return {
      ok: true,
      action: "edit",
      chatId,
      messageId: String(request.messageId),
    };
  }

  async #executeDeleteTelegramAction(
    chatId: string,
    request: TelegramActionRequest & { action: "delete" },
  ): Promise<TelegramActionResult> {
    if (!request.messageId) {
      return { ok: false, action: "delete", chatId, reason: "missing_message_id" };
    }

    const deleted = await this.#deleteMessage(chatId, request.messageId);
    return deleted
      ? {
        ok: true,
        action: "delete",
        chatId,
        messageId: String(request.messageId),
      }
      : {
        ok: false,
        action: "delete",
        chatId,
        reason: "delete_failed",
      };
  }

  async #executeReactTelegramAction(
    chatId: string,
    request: TelegramActionRequest & { action: "react" },
  ): Promise<TelegramActionResult> {
    if (!request.messageId) {
      return { ok: false, action: "react", chatId, reason: "missing_message_id" };
    }
    if (!request.remove && !request.emoji?.trim()) {
      return { ok: false, action: "react", chatId, reason: "missing_emoji" };
    }

    try {
      await this.#callTelegram("setMessageReaction", {
        chat_id: chatId,
        message_id: request.messageId,
        reaction: request.remove ? [] : [{
          type: "emoji",
          emoji: request.emoji?.trim(),
        }],
      });
    } catch (error) {
      return {
        ok: false,
        action: "react",
        chatId,
        reason: formatTelegramRuntimeError(error),
      };
    }

    return {
      ok: true,
      action: "react",
      chatId,
      messageId: String(request.messageId),
    };
  }

  async #resolveStickerFileId(request: TelegramActionRequest & { action: "sticker" }): Promise<string | undefined> {
    if (request.fileId?.trim()) {
      return request.fileId.trim();
    }

    const emoji = request.emoji?.trim();
    if (!emoji) {
      return undefined;
    }

    let fileId = this.#stickerCache.get(emoji)?.[0];
    if (!fileId) {
      await this.#loadStickerPacks();
      fileId = this.#stickerCache.get(emoji)?.[0];
    }
    return fileId;
  }

  async #sendTelegramTextPayload(
    chatId: string,
    prepared: ReturnType<typeof prepareTelegramSingleText>,
    options: {
      replyToMessageId?: number;
      messageThreadId?: number;
    },
  ): Promise<{ ok: boolean; messageId?: string; usedThread: boolean; reason?: string }> {
    const payload = {
      chat_id: chatId,
      text: prepared.text,
      ...(prepared.parseMode ? { parse_mode: prepared.parseMode } : {}),
      ...this.#buildTelegramThreadParams(options),
    };

    try {
      const result = await this.#callWithThreadFallback(
        this.#buildTelegramThreadParams(options),
        (params) => this.#callTelegram<{ message_id?: number }>("sendMessage", {
          chat_id: chatId,
          text: prepared.text,
          ...(prepared.parseMode ? { parse_mode: prepared.parseMode } : {}),
          ...(params ?? {}),
        }),
      );
      if (!result.response) {
        return { ok: false, usedThread: false, reason: result.reason };
      }
      return {
        ok: true,
        messageId: typeof result.response.message_id === "number" ? String(result.response.message_id) : undefined,
        usedThread: result.usedThread,
      };
    } catch (error) {
      if (!prepared.fallbackText || !isTelegramParseModeError(error)) {
        return { ok: false, usedThread: false, reason: formatTelegramRuntimeError(error) };
      }
      const fallback = await this.#callWithThreadFallback(
        this.#buildTelegramThreadParams(options),
        (params) => this.#callTelegram<{ message_id?: number }>("sendMessage", {
          chat_id: chatId,
          text: prepared.fallbackText!,
          ...(params ?? {}),
        }),
      );
      if (!fallback.response) {
        return { ok: false, usedThread: false, reason: fallback.reason };
      }
      return {
        ok: true,
        messageId: typeof fallback.response.message_id === "number" ? String(fallback.response.message_id) : undefined,
        usedThread: fallback.usedThread,
      };
    }
  }

  #buildTelegramThreadParams(options: {
    replyToMessageId?: number;
    messageThreadId?: number;
  }): Record<string, unknown> {
    return {
      ...(options.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
      ...(options.messageThreadId ? { message_thread_id: options.messageThreadId } : {}),
    };
  }

  async #callWithThreadFallback<TResult>(
    threadParams: Record<string, unknown>,
    callback: (params?: Record<string, unknown>) => Promise<TResult>,
  ): Promise<{ response?: TResult; usedThread: boolean; reason?: string }> {
    const hasThread = "message_thread_id" in threadParams;
    try {
      return {
        response: await callback(Object.keys(threadParams).length > 0 ? threadParams : undefined),
        usedThread: hasThread,
      };
    } catch (error) {
      if (!hasThread || !isTelegramMissingThreadError(error)) {
        return {
          usedThread: false,
          reason: formatTelegramRuntimeError(error),
        };
      }

      const fallbackParams = { ...threadParams };
      delete fallbackParams.message_thread_id;
      return {
        response: await callback(Object.keys(fallbackParams).length > 0 ? fallbackParams : undefined),
        usedThread: false,
      };
    }
  }

  async #sendChatMessage(chatId: string, message: TelegramChatResponseMessage): Promise<void> {
    await this.#distributor?.dispatch({
      provider: "telegram-control",
      target: {
        kind: "dm",
        address: chatId,
      },
      content: {
        type: "text",
        text: message.text,
        format: message.format ?? "markdown",
      },
    });
  }

  async #sendSticker(
    chatId: string,
    sticker: NonNullable<TelegramChatResponse["sticker"]>,
  ): Promise<void> {
    if (!this.#config?.reply.stickers.enabled) {
      return;
    }

    const directFileId = sticker.fileId?.trim();
    if (directFileId && this.#distributor) {
      await this.#distributor.dispatch({
        provider: "telegram-control",
        target: {
          kind: "dm",
          address: chatId,
        },
        content: {
          type: "sticker",
          fileId: directFileId,
        },
      });
      return;
    }

    const emoji = sticker.emoji?.trim();
    if (!emoji) {
      return;
    }

    let fileId = this.#stickerCache.get(emoji)?.[0];
    if (!fileId) {
      await this.#loadStickerPacks();
      fileId = this.#stickerCache.get(emoji)?.[0];
    }
    if (!fileId || !this.#distributor) {
      return;
    }

    await this.#distributor.dispatch({
      provider: "telegram-control",
      target: {
        kind: "dm",
        address: chatId,
      },
      content: {
        type: "sticker",
        fileId,
      },
    });
  }

  async #sendTypingAction(chatId: string): Promise<void> {
    await this.#callTelegram("sendChatAction", {
      chat_id: chatId,
      action: "typing",
    }).catch(() => {});
  }

  async #delayNextReply(): Promise<void> {
    const delayMs = this.#config?.reply.splitDelayMs ?? 800;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
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

  async #loadStickerPacks(): Promise<void> {
    this.#stickerCache.clear();
    if (!this.#config?.reply.stickers.enabled) {
      return;
    }

    let store;
    try {
      store = await readTelegramStickerStore(this.#cwd, this.#config);
    } catch (error) {
      const formatted = formatTelegramRuntimeError(error);
      this.#emit({
        type: "warning",
        message: `Telegram sticker store load failed at ${resolveTelegramStickerStorePath(this.#cwd, this.#config)}: ${formatted}`,
      });
      return;
    }

    for (const pack of store.packs) {
      for (const sticker of pack.stickers ?? []) {
        const existing = this.#stickerCache.get(sticker.emoji) ?? [];
        if (!existing.includes(sticker.fileId)) {
          existing.push(sticker.fileId);
        }
        this.#stickerCache.set(sticker.emoji, existing);
        await cacheTelegramSticker(this.#cwd, {
          fileId: sticker.fileId,
          emoji: sticker.emoji,
          setName: pack.telegramSetName,
        }).catch(() => {});
      }

      if (!pack.telegramSetName) {
        continue;
      }

      try {
        await this.#ensureStickerSetCached(pack.telegramSetName);
      } catch (error) {
        const formatted = formatTelegramRuntimeError(error);
        this.#emit({
          type: "warning",
          message: `Telegram sticker pack load failed for ${pack.id}: ${formatted}`,
        });
      }
    }
  }

  async #ensureStickerSetCached(setName: string): Promise<void> {
    const normalizedSetName = setName.trim();
    if (!normalizedSetName) {
      return;
    }

    const result = await this.#callTelegram<{
      stickers?: Array<{ emoji?: string; file_id?: string; file_unique_id?: string }>;
    }>(
      "getStickerSet",
      { name: normalizedSetName },
    );

    const stickers = [];
    for (const sticker of result.stickers ?? []) {
      const emoji = sticker.emoji?.trim();
      const fileId = sticker.file_id?.trim();
      if (!emoji || !fileId) {
        continue;
      }

      const existing = this.#stickerCache.get(emoji) ?? [];
      if (!existing.includes(fileId)) {
        existing.push(fileId);
      }
      this.#stickerCache.set(emoji, existing);
      stickers.push({
        fileId,
        ...(sticker.file_unique_id?.trim() ? { fileUniqueId: sticker.file_unique_id.trim() } : {}),
        emoji,
      });
    }

    if (stickers.length > 0) {
      await cacheTelegramStickerSet(this.#cwd, {
        setName: normalizedSetName,
        stickers,
      }).catch(() => {});
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

function isTelegramParseModeError(error: unknown): boolean {
  const message = flattenTelegramRuntimeError(error).toLowerCase();
  return message.includes("can't parse entities") || message.includes("parse entities");
}

function isTelegramMissingThreadError(error: unknown): boolean {
  return flattenTelegramRuntimeError(error).toLowerCase().includes("message thread not found");
}

function flattenTelegramRuntimeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const causeMessage = error.cause instanceof Error ? error.cause.message : "";
  return [error.message, causeMessage].filter(Boolean).join(": ");
}

function findRecentTelegramStickerMetadata(
  history: Array<{ role: string; metadata?: { telegram?: { chatId?: string; sticker?: { fileId?: string; fileUniqueId?: string; emoji?: string; setName?: string } } } }>,
  activeChatId: string,
) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role !== "user") {
      continue;
    }
    const telegram = history[index]?.metadata?.telegram;
    if (!telegram?.chatId || telegram.chatId !== activeChatId) {
      continue;
    }
    const sticker = telegram.sticker;
    if (sticker?.fileId) {
      return sticker;
    }
  }

  return undefined;
}

function resolveTelegramStickerContext(
  input: { metadata?: { telegram?: { chatId?: string; sticker?: { fileId?: string; fileUniqueId?: string; emoji?: string; setName?: string } } } },
  history: Array<{ role: string; metadata?: { telegram?: { chatId?: string; sticker?: { fileId?: string; fileUniqueId?: string; emoji?: string; setName?: string } } } }>,
  activeChatId: string,
): {
  sticker: { fileId?: string; fileUniqueId?: string; emoji?: string; setName?: string };
  source: ChannelContextResourceSource;
} | undefined {
  if (input.metadata?.telegram?.sticker?.fileId) {
    return {
      sticker: input.metadata.telegram.sticker,
      source: "current_input",
    };
  }

  const recentSticker = findRecentTelegramStickerMetadata(history, activeChatId);
  if (recentSticker?.fileId) {
    return {
      sticker: recentSticker,
      source: "recent_history",
    };
  }

  return undefined;
}

function resolveTelegramAlternativeStickerRequest(
  input: { text?: string },
  sticker: { fileId?: string; fileUniqueId?: string; emoji?: string; setName?: string } | undefined,
): boolean {
  const text = (input.text ?? "").trim().toLowerCase();
  if (!text || !sticker?.setName) {
    return false;
  }

  const mentionsSticker = /\bsticker\b/.test(text) || /表情包/.test(text);
  const requestsAlternative = /\b(other|another|different)\b/.test(text) || /别的|其他/.test(text);
  const mentionsSet = /这套|同一套|same set|this set/.test(text);

  return (mentionsSticker && requestsAlternative) || (mentionsSet && requestsAlternative);
}

function resolveTelegramRequiredAction(
  input: { text?: string; metadata?: { telegram?: { sticker?: { fileId?: string } } } },
  actions: string[],
  stickerContext: {
    sticker?: { fileId?: string; fileUniqueId?: string; emoji?: string; setName?: string };
    source?: ChannelContextResourceSource;
  },
): {
  required: boolean;
  action?: string;
  reason?: string;
  textOnlyFallbackAllowed: boolean;
} | undefined {
  if (!actions.includes("sticker")) {
    return undefined;
  }

  const text = (input.text ?? "").trim().toLowerCase();
  const hasStickerSource = Boolean(stickerContext.sticker?.fileId);
  const hasCurrentStickerInput = Boolean(input.metadata?.telegram?.sticker?.fileId);

  if (!text) {
    if (!hasCurrentStickerInput) {
      return undefined;
    }
    return {
      required: true,
      action: "sticker",
      reason: "current_input_native_resource",
      textOnlyFallbackAllowed: false,
    };
  }

  const mentionsSticker = /\bsticker\b/.test(text) || /表情包/.test(text);
  const rejectsText = /don't use text|do not use text|not text|不要用文本|不要文本/.test(text);
  const rejectsEmoji = /not emoji|don't use emoji|do not use emoji|不是emoji|不要emoji/.test(text);
  const hasSendVerb = /\b(send|reply|use)\b/.test(text) || /发|回|用/.test(text);
  const refersToCurrentResource = /这个|这套|this|same/.test(text) && hasStickerSource;
  const requestsAlternative = resolveTelegramAlternativeStickerRequest(input, stickerContext.sticker);

  if (!mentionsSticker && !refersToCurrentResource) {
    return undefined;
  }

  if (!hasSendVerb && !rejectsText && !rejectsEmoji) {
    return undefined;
  }

  return {
    required: true,
    action: "sticker",
    reason: requestsAlternative
      ? "same_set_alternative"
      : refersToCurrentResource && stickerContext.source === "recent_history"
        ? "recent_history_reference"
      : hasCurrentStickerInput
        ? "current_input_native_resource"
        : "explicit_native_send",
    textOnlyFallbackAllowed: false,
  };
}

function toOptionalNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

function isSupportedTelegramChannelAction(
  action: string,
): action is TelegramActionRequest["action"] {
  return action === "send" || action === "sticker" || action === "edit" || action === "delete" || action === "react";
}

export function isTelegramPollingConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = [error.message, error.cause instanceof Error ? error.cause.message : ""].join(" ").toLowerCase();
  return message.includes("terminated by other getupdates request");
}
