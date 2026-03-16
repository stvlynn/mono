import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { MonoConfigStore } from "@mono/config";
import type { DispatchActionRow } from "@mono/im-platform";
import { normalizeTelegramUserId, readJsonFile, writeJsonFile, type MonoProfileConfig } from "@mono/shared";
import { inferTelegramDisplayLanguage, t, type TelegramDisplayLanguage } from "./language.js";
import type { TelegramCommandResult, TelegramIncomingMessage } from "./types.js";

const TELEGRAM_MODEL_PROFILE_NAME = "telegram-shared";
const MODEL_CONFIG_TTL_MS = 15 * 60 * 1000;
const MODEL_CONFIG_ACTION_PREFIX = "modelcfg";
const PROFILES_PER_PAGE = 6;
const PROFILE_BUTTON_LABEL_MAX_CHARS = 28;

type TelegramModelApiKind = "openai" | "anthropic" | "google";
type TelegramModelWizardStep =
  | "choose-family"
  | "choose-base-url-mode"
  | "await-custom-base-url"
  | "choose-model-mode"
  | "await-custom-model"
  | "confirm-api-key"
  | "await-api-key"
  | "review"
  | "choose-existing-profile"
  | "review-existing-profile";

interface TelegramModelWizardState {
  id: string;
  senderId: string;
  chatId: string;
  createdAt: number;
  updatedAt: number;
  language: TelegramDisplayLanguage;
  step: TelegramModelWizardStep;
  apiKind?: TelegramModelApiKind;
  baseURL?: string;
  modelId?: string;
  apiKeyMessageId?: number;
  pickerPage?: number;
  selectedProfileName?: string;
}

interface TelegramModelWizardStoreFile {
  version: 1;
  sessions: TelegramModelWizardState[];
  preferences?: Array<{ senderId: string; language: TelegramDisplayLanguage }>;
}

interface TelegramModelWizardResult extends TelegramCommandResult {
  configuredProfileName?: string;
  removedProfileName?: string;
  deleteSourceMessageId?: number;
}

interface TelegramModelPreset {
  label: string;
  provider: string;
  family: MonoProfileConfig["family"];
  transport: MonoProfileConfig["transport"];
  providerFactory: NonNullable<MonoProfileConfig["providerFactory"]>;
  officialBaseURL: string;
  suggestedModel: string;
}

export interface TelegramSelectableProfile {
  name: string;
  model: {
    provider: string;
    modelId: string;
    baseURL: string;
  };
}

const MODEL_PRESETS: Record<TelegramModelApiKind, TelegramModelPreset> = {
  openai: {
    label: "OpenAI-compatible",
    provider: "openai",
    family: "openai-compatible",
    transport: "openai-compatible",
    providerFactory: "openai",
    officialBaseURL: "https://api.openai.com/v1",
    suggestedModel: "gpt-4.1-mini",
  },
  anthropic: {
    label: "Anthropic-compatible",
    provider: "anthropic",
    family: "anthropic",
    transport: "anthropic",
    providerFactory: "anthropic",
    officialBaseURL: "https://api.anthropic.com/v1",
    suggestedModel: "claude-sonnet-4-5",
  },
  google: {
    label: "Google/Gemini-compatible",
    provider: "google",
    family: "gemini",
    transport: "gemini",
    providerFactory: "google",
    officialBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    suggestedModel: "gemini-2.5-pro",
  },
};

type ParsedModelConfigAction =
  | { kind: "start-existing" }
  | { kind: "start-shared" }
  | { kind: "cancel" }
  | { kind: "set-language"; language: TelegramDisplayLanguage; sessionId?: string }
  | { kind: "family"; sessionId: string; apiKind: TelegramModelApiKind }
  | { kind: "base-url"; sessionId: string; mode: "official" | "custom" }
  | { kind: "model"; sessionId: string; mode: "suggested" | "custom" }
  | { kind: "api-key"; sessionId: string; mode: "continue" | "cancel" }
  | { kind: "review"; sessionId: string; mode: "save" | "cancel" }
  | { kind: "existing-page"; sessionId: string; page: number }
  | { kind: "existing-select"; sessionId: string; index: number }
  | { kind: "existing-review"; sessionId: string; mode: "enable" | "remove" | "cancel" };

export function buildTelegramModelEntryActions(language: TelegramDisplayLanguage = "en", sessionId?: string): DispatchActionRow[] {
  return [[
    {
      id: buildTelegramModelConfigActionId("start-existing"),
      label: t(language, "choose_existing_profile"),
      style: "primary",
    },
    {
      id: buildTelegramModelConfigActionId("start-shared"),
      label: t(language, "configure_shared_profile"),
      style: "default",
    },
  ], buildLanguageActions(language, sessionId)];
}

export function buildTelegramModelMenuResult(language: TelegramDisplayLanguage = "en"): TelegramCommandResult {
  return {
    ok: true,
    title: t(language, "model_menu_title"),
    lines: [
      t(language, "model_menu_line_1"),
      t(language, "model_menu_line_2"),
    ],
    status: "Telegram model menu",
    actions: buildTelegramModelEntryActions(language),
  };
}

export class TelegramModelConfigWizard {
  readonly #cwd: string;
  readonly #apiKeys = new Map<string, string>();
  readonly #listConfiguredProfiles?: () => Promise<TelegramSelectableProfile[]>;

  constructor(options: {
    cwd?: string;
    listConfiguredProfiles?: () => Promise<TelegramSelectableProfile[]>;
  } = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#listConfiguredProfiles = options.listConfiguredProfiles;
  }

  async hasActiveSession(senderId: string | undefined): Promise<boolean> {
    const normalizedSenderId = normalizeTelegramUserId(senderId);
    if (!normalizedSenderId) {
      return false;
    }

    return (await this.#readSession(normalizedSenderId)) !== undefined;
  }

  async startShared(message: TelegramIncomingMessage): Promise<TelegramModelWizardResult> {
    const senderId = normalizeTelegramUserId(message.senderId ?? message.chatId);
    if (!senderId) {
      throw new Error("Telegram sender id must be a positive numeric Telegram user id");
    }

    await this.cancel(senderId);

    const now = Date.now();
    const language = await this.#resolveLanguage(senderId, message.languageCode);
    const session: TelegramModelWizardState = {
      id: createWizardSessionId(),
      senderId,
      chatId: message.chatId,
      createdAt: now,
      updatedAt: now,
      language,
      step: "choose-family",
    };
    await this.#writeSession(session);

    return this.#renderCurrentStep(session, t(language, "choose_api_type"));
  }

  async startExisting(message: TelegramIncomingMessage): Promise<TelegramModelWizardResult> {
    const senderId = normalizeTelegramUserId(message.senderId ?? message.chatId);
    if (!senderId) {
      throw new Error("Telegram sender id must be a positive numeric Telegram user id");
    }

    const profiles = await this.#loadProfiles();
    const language = await this.#resolveLanguage(senderId, message.languageCode);
    if (profiles.length === 0) {
      return {
        ok: true,
        title: t(language, "no_existing_profiles_title"),
        lines: [
          t(language, "no_existing_profiles_line_1"),
          t(language, "no_existing_profiles_line_2"),
        ],
        status: "No existing Telegram profiles available",
        actions: [[
          {
            id: buildTelegramModelConfigActionId("start-shared"),
            label: t(language, "configure_shared_profile"),
            style: "primary",
          },
        ], buildLanguageActions(language)],
      };
    }

    await this.cancel(senderId);

    const now = Date.now();
    const session: TelegramModelWizardState = {
      id: createWizardSessionId(),
      senderId,
      chatId: message.chatId,
      createdAt: now,
      updatedAt: now,
      language,
      step: "choose-existing-profile",
      pickerPage: 0,
    };
    await this.#writeSession(session);

    return this.#renderCurrentStep(session, t(language, "choose_existing_profiles"));
  }

  async cancel(senderId: string | undefined): Promise<TelegramModelWizardResult | null> {
    const normalizedSenderId = normalizeTelegramUserId(senderId);
    if (!normalizedSenderId) {
      return null;
    }

    const session = await this.#readSession(normalizedSenderId);
    if (!session) {
      return null;
    }

    await this.#deleteSession(normalizedSenderId);
    this.#apiKeys.delete(normalizedSenderId);
    const language = await this.#resolveLanguage(normalizedSenderId);
    return {
      ok: true,
      title: t(language, "model_setup_cancelled_title"),
      lines: [
        t(language, "model_setup_cancelled_line_1"),
        t(language, "model_setup_cancelled_line_2"),
      ],
      status: "Cancelled Telegram model configuration",
    };
  }

  async handleText(message: TelegramIncomingMessage): Promise<TelegramModelWizardResult | null> {
    const senderId = normalizeTelegramUserId(message.senderId ?? message.chatId);
    if (!senderId) {
      return null;
    }

    const session = await this.#readSession(senderId);
    if (!session) {
      return null;
    }

    const text = message.text?.trim() ?? "";
    if (!text) {
      return this.#renderCurrentStep(session, t(session.language, "send_text_for_current_step"));
    }

    switch (session.step) {
      case "await-custom-base-url": {
        const normalized = normalizeBaseURL(text);
        if (!normalized) {
          return {
            ok: false,
            title: t(session.language, "custom_base_url_title"),
            lines: [
              t(session.language, "custom_base_url_invalid"),
              t(session.language, "official_base_url_example", { baseURL: this.#requirePreset(session).officialBaseURL }),
            ],
            status: "Invalid custom base URL",
          };
        }

        session.baseURL = normalized;
        session.step = "choose-model-mode";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "custom_base_url_title"));
      }

      case "await-custom-model": {
        const modelId = text.trim();
        if (!modelId) {
          return {
            ok: false,
            title: t(session.language, "custom_model_id_title"),
            lines: [t(session.language, "custom_model_id_invalid")],
            status: "Invalid custom model id",
          };
        }

        session.modelId = modelId;
        session.step = "confirm-api-key";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "custom_model_id_title"));
      }

      case "await-api-key": {
        const apiKey = text.trim();
        if (!apiKey) {
          return {
            ok: false,
            title: t(session.language, "api_key_title"),
            lines: [t(session.language, "api_key_invalid")],
            status: "Invalid API key",
          };
        }

        this.#apiKeys.set(senderId, apiKey);
        session.apiKeyMessageId = message.messageId;
        session.step = "review";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "api_key_received"));
      }

      default:
        return this.#renderCurrentStep(session, t(session.language, "send_text_for_current_step"));
    }
  }

  async handleAction(params: {
    actionId: string;
    senderId: string;
    chatId: string;
  }): Promise<TelegramModelWizardResult | null> {
    const action = parseTelegramModelConfigActionId(params.actionId);
    if (!action) {
      return null;
    }

    if (action.kind === "start-shared") {
      return this.startShared({
        messageId: 0,
        chatId: params.chatId,
        chatType: "private",
        senderId: params.senderId,
      });
    }

    if (action.kind === "start-existing") {
      return this.startExisting({
        messageId: 0,
        chatId: params.chatId,
        chatType: "private",
        senderId: params.senderId,
      });
    }

    if (action.kind === "cancel") {
      return (await this.cancel(params.senderId)) ?? {
        ok: true,
        title: t(await this.#resolveLanguage(params.senderId), "no_flow_active_title"),
        lines: [t(await this.#resolveLanguage(params.senderId), "no_flow_active_line_1"), t(await this.#resolveLanguage(params.senderId), "no_flow_active_line_2")],
        status: "No Telegram model configuration in progress",
        actions: buildTelegramModelEntryActions(await this.#resolveLanguage(params.senderId)),
      };
    }

    const senderId = normalizeTelegramUserId(params.senderId);
    if (!senderId) {
      return {
        ok: false,
        title: t(await this.#resolveLanguage(params.senderId), "model_setup_cancelled_title"),
        lines: [t(await this.#resolveLanguage(params.senderId), "invalid_sender_id")],
        status: "Invalid Telegram sender id",
      };
    }

    if (action.kind === "set-language") {
      await this.#writePreference(senderId, action.language);
      const sessionForLanguage = action.sessionId ? await this.#readSession(senderId) : undefined;
      if (sessionForLanguage && (!action.sessionId || sessionForLanguage.id === action.sessionId)) {
        sessionForLanguage.language = action.language;
        sessionForLanguage.updatedAt = Date.now();
        await this.#writeSession(sessionForLanguage);
        return this.#renderCurrentStep(sessionForLanguage, t(action.language, "language_label"));
      }
      return buildTelegramModelMenuResult(action.language);
    }

    const session = await this.#readSession(senderId);
    if (!session || session.id !== action.sessionId) {
      return {
        ok: false,
        title: t(await this.#resolveLanguage(senderId), "expired_session_title"),
        lines: [
          t(await this.#resolveLanguage(senderId), "expired_session_line_1"),
          t(await this.#resolveLanguage(senderId), "expired_session_line_2"),
        ],
        status: "Expired Telegram model configuration session",
        actions: buildTelegramModelEntryActions(await this.#resolveLanguage(senderId)),
      };
    }

    switch (action.kind) {
      case "family":
        session.apiKind = action.apiKind;
        session.baseURL = undefined;
        session.modelId = undefined;
        session.step = "choose-base-url-mode";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "family_selected", { label: apiKindLabel(session.language, action.apiKind) }));

      case "base-url":
        if (action.mode === "official") {
          session.baseURL = this.#requirePreset(session).officialBaseURL;
          session.step = "choose-model-mode";
          session.updatedAt = Date.now();
          await this.#writeSession(session);
          return this.#renderCurrentStep(session, t(session.language, "official_base_url_selected"));
        }
        session.step = "await-custom-base-url";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "send_custom_base_url"));

      case "model":
        if (action.mode === "suggested") {
          session.modelId = this.#requirePreset(session).suggestedModel;
          session.step = "confirm-api-key";
          session.updatedAt = Date.now();
          await this.#writeSession(session);
          return this.#renderCurrentStep(session, t(session.language, "suggested_model_selected"));
        }
        session.step = "await-custom-model";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "send_custom_model"));

      case "api-key":
        if (action.mode === "cancel") {
          return (await this.cancel(senderId)) ?? null;
        }
        session.step = "await-api-key";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "send_api_key_next"));

      case "review":
        if (action.mode === "cancel") {
          return (await this.cancel(senderId)) ?? null;
        }
        return this.#saveConfiguredProfile(session);

      case "existing-page":
        session.pickerPage = action.page;
        session.step = "choose-existing-profile";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "choose_existing_profiles"));

      case "existing-select": {
        const profile = await this.#resolveProfileByPageIndex(session, action.index);
        if (!profile) {
          return this.#renderCurrentStep(
            session,
            session.language === "zh" ? "列表已变化，请重新选择。" : "The profile list changed. Please choose again.",
          );
        }
        session.selectedProfileName = profile.name;
        session.step = "review-existing-profile";
        session.updatedAt = Date.now();
        await this.#writeSession(session);
        return this.#renderCurrentStep(session, t(session.language, "selected_profile", { profileName: profile.name }));
      }

      case "existing-review":
        if (action.mode === "cancel") {
          return (await this.cancel(senderId)) ?? null;
        }
        if (action.mode === "remove") {
          return this.#removeExistingProfile(session);
        }
        return this.#enableExistingProfile(session);

      default:
        return null;
    }
  }

  async #enableExistingProfile(session: TelegramModelWizardState): Promise<TelegramModelWizardResult> {
    const profile = await this.#findProfileByName(session.selectedProfileName);
    if (!profile) {
      return {
        ok: false,
        title: t(session.language, "existing_profile_unavailable_title"),
        lines: [
          t(session.language, "existing_profile_unavailable_line_1"),
          t(session.language, "existing_profile_unavailable_line_2"),
        ],
        status: "Telegram selected profile is unavailable",
        actions: buildTelegramModelEntryActions(session.language),
      };
    }

    await this.#deleteSession(session.senderId);

    return {
      ok: true,
      title: t(session.language, "existing_profile_selected_title"),
      lines: [
        t(session.language, "selected_profile", { profileName: profile.name }),
        t(session.language, "model_label", { provider: profile.model.provider, modelId: profile.model.modelId }),
        t(session.language, "base_url_label", { baseURL: profile.model.baseURL }),
      ],
      status: t(session.language, "existing_profile_selected_status", { profileName: profile.name }),
      configuredProfileName: profile.name,
    };
  }

  async #removeExistingProfile(session: TelegramModelWizardState): Promise<TelegramModelWizardResult> {
    const profileName = session.selectedProfileName;
    if (!profileName) {
      return {
        ok: false,
        title: t(session.language, "existing_profile_unavailable_title"),
        lines: [
          t(session.language, "existing_profile_unavailable_line_1"),
          t(session.language, "existing_profile_unavailable_line_2"),
        ],
        status: "Telegram selected profile is unavailable",
        actions: buildTelegramModelEntryActions(session.language),
      };
    }

    const removed = await removeTelegramProfile({
      cwd: this.#cwd,
      profileName,
    });

    if (!removed.removed) {
      return {
        ok: false,
        title: t(session.language, "existing_profile_unavailable_title"),
        lines: [
          t(session.language, "existing_profile_missing", { profileName }),
          t(session.language, "existing_profile_unavailable_line_2"),
        ],
        status: `Telegram selected profile ${profileName} is unavailable`,
        actions: buildTelegramModelEntryActions(session.language),
      };
    }

    await this.#deleteSession(session.senderId);

    return {
      ok: true,
      title: t(session.language, "existing_profile_removed_title"),
      lines: [
        t(session.language, "removed_profile", { profileName }),
        removed.nextDefaultProfile
          ? t(session.language, "new_default_profile", { profileName: removed.nextDefaultProfile })
          : t(session.language, "no_remaining_default_profile"),
      ],
      status: t(session.language, "existing_profile_removed_status", { profileName }),
      removedProfileName: profileName,
    };
  }

  async #saveConfiguredProfile(session: TelegramModelWizardState): Promise<TelegramModelWizardResult> {
    const senderId = session.senderId;
    const apiKey = this.#apiKeys.get(senderId);
    const preset = this.#requirePreset(session);

    if (!session.baseURL || !session.modelId || !apiKey) {
      return this.#renderCurrentStep(session, "Complete all steps before saving.");
    }

    await saveTelegramSharedProfile({
      cwd: this.#cwd,
      apiKind: session.apiKind!,
      baseURL: session.baseURL,
      modelId: session.modelId,
      apiKey,
    });

    await this.#deleteSession(senderId);
    this.#apiKeys.delete(senderId);

    return {
      ok: true,
      title: t(session.language, "shared_profile_saved_title"),
      lines: [
        t(session.language, "shared_profile_saved", { profileName: TELEGRAM_MODEL_PROFILE_NAME }),
        t(session.language, "api_type_label", { label: apiKindLabel(session.language, session.apiKind!) }),
        t(session.language, "base_url_label", { baseURL: session.baseURL }),
        t(session.language, "model_label", { provider: preset.provider, modelId: session.modelId }),
        t(session.language, "api_key_saved"),
      ],
      status: t(session.language, "shared_profile_saved_status", { label: apiKindLabel(session.language, session.apiKind!) }),
      configuredProfileName: TELEGRAM_MODEL_PROFILE_NAME,
      deleteSourceMessageId: session.apiKeyMessageId,
    };
  }

  async #renderCurrentStep(
    session: TelegramModelWizardState,
    lead: string,
  ): Promise<TelegramModelWizardResult> {
    const preset = session.apiKind ? this.#requirePreset(session) : undefined;

    switch (session.step) {
      case "choose-existing-profile": {
        const profiles = await this.#loadProfiles();
        if (profiles.length === 0) {
          return {
            ok: true,
            title: t(session.language, "no_existing_profiles_title"),
            lines: [
              t(session.language, "no_existing_profiles_line_1"),
              t(session.language, "no_existing_profiles_line_2"),
            ],
            status: "No existing Telegram profiles available",
            actions: [[
              {
                id: buildTelegramModelConfigActionId("start-shared"),
                label: t(session.language, "configure_shared_profile"),
                style: "primary",
              },
            ], buildLanguageActions(session.language, session.id)],
          };
        }

        const totalPages = Math.max(1, Math.ceil(profiles.length / PROFILES_PER_PAGE));
        const page = clampPage(session.pickerPage ?? 0, totalPages);
        const pageProfiles = profiles.slice(page * PROFILES_PER_PAGE, (page + 1) * PROFILES_PER_PAGE);
        const lines = [
          lead,
          t(session.language, "page_label", { page: page + 1, totalPages }),
          "",
          ...pageProfiles.map((profile, index) =>
            `${index + 1}. ${profile.name} · ${profile.model.provider}/${profile.model.modelId}`
          ),
        ];

        const profileButtons = pageProfiles.map((profile, index) => [{
          id: buildTelegramModelConfigActionId("existing-select", session.id, String(index)),
          label: truncateButtonLabel(profile.name),
          style: "default" as const,
        }]);

        const paginationRow = [
          ...(page > 0 ? [{
            id: buildTelegramModelConfigActionId("existing-page", session.id, String(page - 1)),
            label: session.language === "zh" ? "上一页" : "Prev",
            style: "default" as const,
          }] : []),
          ...(page < totalPages - 1 ? [{
            id: buildTelegramModelConfigActionId("existing-page", session.id, String(page + 1)),
            label: session.language === "zh" ? "下一页" : "Next",
            style: "default" as const,
          }] : []),
        ];

        return {
          ok: true,
          title: t(session.language, "choose_existing_profile_title"),
          lines,
          status: t(session.language, "waiting_existing_selection"),
          actions: [
            ...profileButtons,
            ...(paginationRow.length > 0 ? [paginationRow] : []),
            [
              {
                id: buildTelegramModelConfigActionId("start-shared"),
                label: t(session.language, "configure_shared_profile_cta"),
                style: "default",
              },
              cancelWizardActionButton(session.language),
            ],
            buildLanguageActions(session.language, session.id),
          ],
        };
      }

      case "review-existing-profile": {
        const profile = await this.#findProfileByName(session.selectedProfileName);
        if (!profile) {
          session.step = "choose-existing-profile";
          session.updatedAt = Date.now();
          await this.#writeSession(session);
          return this.#renderCurrentStep(session, t(session.language, "existing_profile_unavailable_line_1"));
        }

        return {
          ok: true,
          title: t(session.language, "review_existing_title"),
          lines: [
            lead,
            t(session.language, "selected_profile", { profileName: profile.name }),
            t(session.language, "model_label", { provider: profile.model.provider, modelId: profile.model.modelId }),
            t(session.language, "base_url_label", { baseURL: profile.model.baseURL }),
            t(session.language, "review_existing_line"),
          ],
          status: t(session.language, "waiting_existing_review"),
          actions: [[
            {
              id: buildTelegramModelConfigActionId("existing-review", session.id, "enable"),
              label: t(session.language, "enable"),
              style: "primary",
            },
            {
              id: buildTelegramModelConfigActionId("existing-review", session.id, "remove"),
              label: t(session.language, "remove"),
              style: "danger",
            },
          ], [
            {
              id: buildTelegramModelConfigActionId("existing-page", session.id, String(session.pickerPage ?? 0)),
              label: t(session.language, "back_to_list"),
              style: "default",
            },
            cancelWizardActionButton(session.language),
          ], buildLanguageActions(session.language, session.id)],
        };
      }

      case "choose-family":
        return {
          ok: true,
          title: t(session.language, "shared_profile_setup_title"),
          lines: [
            lead,
            t(session.language, "choose_api_type"),
            t(session.language, "third_party_note"),
          ],
          status: t(session.language, "waiting_api_type"),
          actions: [[
            wizardActionButton(session.id, "family", "openai", t(session.language, "api_kind_openai")),
            wizardActionButton(session.id, "family", "anthropic", t(session.language, "api_kind_anthropic")),
          ], [
            wizardActionButton(session.id, "family", "google", t(session.language, "api_kind_google")),
            cancelWizardActionButton(session.language),
          ], buildLanguageActions(session.language, session.id)],
        };

      case "choose-base-url-mode":
        return {
          ok: true,
          title: t(session.language, "shared_profile_setup_title"),
          lines: [
            lead,
            t(session.language, "selected_api_type", { label: apiKindLabel(session.language, session.apiKind!) }),
            t(session.language, "official_base_url_example", { baseURL: preset!.officialBaseURL }),
            t(session.language, "official_or_custom_url"),
          ],
          status: t(session.language, "waiting_base_url_selection"),
          actions: [[
            wizardActionButton(session.id, "base-url", "official", t(session.language, "use_official_example")),
            wizardActionButton(session.id, "base-url", "custom", t(session.language, "enter_custom_url")),
          ], [
            cancelWizardActionButton(session.language),
          ], buildLanguageActions(session.language, session.id)],
        };

      case "await-custom-base-url":
        return {
          ok: true,
          title: t(session.language, "custom_base_url_title"),
          lines: [
            lead,
            t(session.language, "selected_api_type", { label: apiKindLabel(session.language, session.apiKind!) }),
            t(session.language, "official_base_url_example", { baseURL: preset!.officialBaseURL }),
            t(session.language, "send_custom_base_url_now"),
          ],
          status: t(session.language, "waiting_custom_base_url_input"),
          actions: [[cancelWizardActionButton(session.language)], buildLanguageActions(session.language, session.id)],
        };

      case "choose-model-mode":
        return {
          ok: true,
          title: t(session.language, "shared_profile_setup_title"),
          lines: [
            lead,
            t(session.language, "api_type_label", { label: apiKindLabel(session.language, session.apiKind!) }),
            t(session.language, "base_url_label", { baseURL: session.baseURL! }),
            t(session.language, "suggested_model_example", { modelId: preset!.suggestedModel }),
            t(session.language, "use_suggested_or_custom_model"),
          ],
          status: t(session.language, "waiting_model_selection"),
          actions: [[
            wizardActionButton(session.id, "model", "suggested", t(session.language, "use_suggested_model")),
            wizardActionButton(session.id, "model", "custom", t(session.language, "enter_custom_model")),
          ], [
            cancelWizardActionButton(session.language),
          ], buildLanguageActions(session.language, session.id)],
        };

      case "await-custom-model":
        return {
          ok: true,
          title: t(session.language, "custom_model_id_title"),
          lines: [
            lead,
            t(session.language, "api_type_label", { label: apiKindLabel(session.language, session.apiKind!) }),
            t(session.language, "base_url_label", { baseURL: session.baseURL! }),
            t(session.language, "suggested_model_example_alt", { modelId: preset!.suggestedModel }),
            t(session.language, "send_custom_model_now"),
          ],
          status: t(session.language, "waiting_custom_model_input"),
          actions: [[cancelWizardActionButton(session.language)], buildLanguageActions(session.language, session.id)],
        };

      case "confirm-api-key":
        return {
          ok: true,
          title: t(session.language, "api_key_title"),
          lines: [
            lead,
            t(session.language, "api_type_label", { label: apiKindLabel(session.language, session.apiKind!) }),
            t(session.language, "base_url_label", { baseURL: session.baseURL! }),
            t(session.language, "model_label", { provider: preset!.provider, modelId: session.modelId! }),
            "",
            t(session.language, "warning_not_secure"),
            t(session.language, "key_stored_locally"),
            t(session.language, "delete_message_after_save"),
          ],
          status: t(session.language, "waiting_api_key_confirmation"),
          actions: [[
            wizardActionButton(session.id, "api-key", "continue", t(session.language, "send_api_key")),
            wizardActionButton(session.id, "api-key", "cancel", t(session.language, "cancel")),
          ], buildLanguageActions(session.language, session.id)],
        };

      case "await-api-key":
        return {
          ok: true,
          title: t(session.language, "api_key_title"),
          lines: [
            lead,
            t(session.language, "send_api_key_now"),
            t(session.language, "delete_message_after_save_short"),
          ],
          status: t(session.language, "waiting_api_key_input"),
          actions: [[cancelWizardActionButton(session.language)], buildLanguageActions(session.language, session.id)],
        };

      case "review":
        return {
          ok: true,
          title: t(session.language, "review_shared_profile_title"),
          lines: [
            lead,
            t(session.language, "shared_profile_saved", { profileName: TELEGRAM_MODEL_PROFILE_NAME }),
            t(session.language, "api_type_label", { label: preset!.label }),
            t(session.language, "base_url_label", { baseURL: session.baseURL! }),
            t(session.language, "model_label", { provider: preset!.provider, modelId: session.modelId! }),
            t(session.language, "api_key_captured", { value: labelYesNo(session.language, this.#apiKeys.has(session.senderId)) }),
            t(session.language, "save_shared_profile_line"),
          ],
          status: t(session.language, "waiting_shared_save"),
          actions: [[
            wizardActionButton(session.id, "review", "save", t(session.language, "save_and_apply")),
            wizardActionButton(session.id, "review", "cancel", t(session.language, "cancel")),
          ], buildLanguageActions(session.language, session.id)],
        };
    }
  }

  #requirePreset(session: TelegramModelWizardState): TelegramModelPreset {
    if (!session.apiKind) {
      throw new Error("Telegram model wizard API type is not selected");
    }
    return MODEL_PRESETS[session.apiKind];
  }

  async #loadProfiles(): Promise<TelegramSelectableProfile[]> {
    const profiles = await this.#listConfiguredProfiles?.();
    return (profiles ?? []).slice().sort((left, right) => left.name.localeCompare(right.name));
  }

  async #resolveLanguage(
    senderId: string,
    languageCode?: string,
  ): Promise<TelegramDisplayLanguage> {
    const file = await this.#readStore();
    const stored = file.preferences?.find((item) => item.senderId === senderId)?.language;
    return stored ?? inferTelegramDisplayLanguage(languageCode);
  }

  async #writePreference(senderId: string, language: TelegramDisplayLanguage): Promise<void> {
    const file = await this.#readStore();
    const preferences = (file.preferences ?? []).filter((item) => item.senderId !== senderId);
    preferences.push({ senderId, language });
    await this.#writeStore({
      version: 1,
      sessions: file.sessions,
      preferences,
    });
  }

  async #findProfileByName(name: string | undefined): Promise<TelegramSelectableProfile | undefined> {
    if (!name) {
      return undefined;
    }
    const profiles = await this.#loadProfiles();
    return profiles.find((profile) => profile.name === name);
  }

  async #resolveProfileByPageIndex(
    session: TelegramModelWizardState,
    index: number,
  ): Promise<TelegramSelectableProfile | undefined> {
    const profiles = await this.#loadProfiles();
    const totalPages = Math.max(1, Math.ceil(profiles.length / PROFILES_PER_PAGE));
    const page = clampPage(session.pickerPage ?? 0, totalPages);
    const offset = page * PROFILES_PER_PAGE;
    return profiles[offset + index];
  }

  async #readSession(senderId: string): Promise<TelegramModelWizardState | undefined> {
    const file = await this.#readStore();
    const now = Date.now();
    const sessions = file.sessions.filter((session) => now - session.updatedAt <= MODEL_CONFIG_TTL_MS);
    if (sessions.length !== file.sessions.length) {
      await this.#writeStore({ version: 1, sessions, preferences: file.preferences });
    }
    return sessions.find((session) => session.senderId === senderId);
  }

  async #writeSession(session: TelegramModelWizardState): Promise<void> {
    const file = await this.#readStore();
    const sessions = file.sessions.filter((item) => item.senderId !== session.senderId);
    sessions.push(session);
    await this.#writeStore({ version: 1, sessions, preferences: file.preferences });
  }

  async #deleteSession(senderId: string): Promise<void> {
    const file = await this.#readStore();
    const sessions = file.sessions.filter((item) => item.senderId !== senderId);
    await this.#writeStore({ version: 1, sessions, preferences: file.preferences });
  }

  async #readStore(): Promise<TelegramModelWizardStoreFile> {
    const path = resolveModelWizardStorePath(this.#cwd);
    const file = await readJsonFile<TelegramModelWizardStoreFile>(path);
    return {
      version: 1,
      sessions: file?.sessions ?? [],
      preferences: file?.preferences ?? [],
    };
  }

  async #writeStore(file: TelegramModelWizardStoreFile): Promise<void> {
    await ensureTelegramStateDir(this.#cwd);
    await writeJsonFile(resolveModelWizardStorePath(this.#cwd), file);
  }
}

function wizardActionButton(
  sessionId: string,
  kind: "family" | "base-url" | "model" | "api-key" | "review",
  value: string,
  label: string,
) {
  return {
    id: buildTelegramModelConfigActionId(kind, sessionId, value),
    label,
    style: kind === "review" && value === "save" ? "primary" : "default",
  } as const;
}

function apiKindLabel(language: TelegramDisplayLanguage, kind: TelegramModelApiKind): string {
  switch (kind) {
    case "openai":
      return t(language, "api_kind_openai");
    case "anthropic":
      return t(language, "api_kind_anthropic");
    case "google":
      return t(language, "api_kind_google");
  }
}

function cancelWizardActionButton(language: TelegramDisplayLanguage = "en") {
  return {
    id: buildTelegramModelConfigActionId("cancel"),
    label: t(language, "cancel"),
    style: "danger",
  } as const;
}

function buildLanguageActions(
  language: TelegramDisplayLanguage,
  sessionId?: string,
): DispatchActionRow {
  return [
    {
      id: buildTelegramModelConfigActionId("set-language", sessionId, "zh"),
      label: t(language, "language_chinese"),
      style: language === "zh" ? "primary" : "default",
    },
    {
      id: buildTelegramModelConfigActionId("set-language", sessionId, "en"),
      label: t(language, "language_english"),
      style: language === "en" ? "primary" : "default",
    },
  ];
}

function labelYesNo(language: TelegramDisplayLanguage, value: boolean): string {
  if (language === "zh") {
    return value ? "是" : "否";
  }
  return value ? "yes" : "no";
}

function buildTelegramModelConfigActionId(
  kind:
    | "start-existing"
    | "start-shared"
    | "cancel"
    | "set-language"
    | "family"
    | "base-url"
    | "model"
    | "api-key"
    | "review"
    | "existing-page"
    | "existing-select"
    | "existing-review",
  sessionId?: string,
  value?: string,
): string {
  if (kind === "set-language") {
    return [MODEL_CONFIG_ACTION_PREFIX, kind, value, sessionId].filter(Boolean).join(":");
  }
  return [MODEL_CONFIG_ACTION_PREFIX, kind, sessionId, value].filter(Boolean).join(":");
}

function createWizardSessionId(): string {
  return randomBytes(6).toString("base64url");
}

function parseTelegramModelConfigActionId(actionId: string): ParsedModelConfigAction | null {
  const [prefix, kind, sessionId, value] = actionId.trim().split(":");
  if (prefix !== MODEL_CONFIG_ACTION_PREFIX) {
    return null;
  }

  if (kind === "start-existing") {
    return { kind };
  }

  if (kind === "start-shared") {
    return { kind };
  }

  if (kind === "cancel") {
    return { kind };
  }

  if (kind === "set-language" && (sessionId === "zh" || sessionId === "en")) {
    return value
      ? { kind, language: sessionId, sessionId: value }
      : { kind, language: sessionId };
  }

  if (!sessionId || !value) {
    return null;
  }

  if (kind === "family" && (value === "openai" || value === "anthropic" || value === "google")) {
    return { kind, sessionId, apiKind: value };
  }

  if (kind === "base-url" && (value === "official" || value === "custom")) {
    return { kind, sessionId, mode: value };
  }

  if (kind === "model" && (value === "suggested" || value === "custom")) {
    return { kind, sessionId, mode: value };
  }

  if (kind === "api-key" && (value === "continue" || value === "cancel")) {
    return { kind, sessionId, mode: value };
  }

  if (kind === "review" && (value === "save" || value === "cancel")) {
    return { kind, sessionId, mode: value };
  }

  if (kind === "existing-page") {
    const page = Number.parseInt(value, 10);
    return Number.isInteger(page) ? { kind, sessionId, page } : null;
  }

  if (kind === "existing-select") {
    const index = Number.parseInt(value, 10);
    return Number.isInteger(index) ? { kind, sessionId, index } : null;
  }

  if (kind === "existing-review" && (value === "enable" || value === "remove" || value === "cancel")) {
    return { kind, sessionId, mode: value };
  }

  return null;
}

function normalizeLanguage(value: string | undefined): TelegramDisplayLanguage | undefined {
  if (value === "zh" || value === "en") {
    return value;
  }
  return undefined;
}

async function saveTelegramSharedProfile(options: {
  cwd: string;
  apiKind: TelegramModelApiKind;
  baseURL: string;
  modelId: string;
  apiKey: string;
}): Promise<void> {
  const store = new MonoConfigStore(options.cwd);
  const config = (await store.readGlobalConfig()) ?? await store.initGlobalConfig();
  const preset = MODEL_PRESETS[options.apiKind];
  const usingOfficialOpenAIBaseURL =
    options.apiKind === "openai"
    && normalizeBaseURL(options.baseURL) === normalizeBaseURL(preset.officialBaseURL);

  config.mono.profiles[TELEGRAM_MODEL_PROFILE_NAME] = {
    provider: preset.provider,
    modelId: options.modelId,
    baseURL: options.baseURL,
    family: preset.family,
    transport: preset.transport,
    providerFactory: options.apiKind === "openai" && !usingOfficialOpenAIBaseURL
      ? "custom"
      : preset.providerFactory,
    apiKeyRef: `local:${TELEGRAM_MODEL_PROFILE_NAME}`,
    apiKeyEnv: undefined,
    supportsTools: true,
    supportsReasoning: true,
    supportsAttachments: true,
  } satisfies MonoProfileConfig;
  config.mono.defaultProfile = TELEGRAM_MODEL_PROFILE_NAME;

  await store.writeGlobalConfig(config);
  await store.setProfileSecret(TELEGRAM_MODEL_PROFILE_NAME, options.apiKey);
}

async function removeTelegramProfile(options: {
  cwd: string;
  profileName: string;
}): Promise<{ removed: boolean; nextDefaultProfile?: string }> {
  const store = new MonoConfigStore(options.cwd);
  const config = await store.readGlobalConfig();
  if (!config?.mono.profiles[options.profileName]) {
    return { removed: false };
  }

  delete config.mono.profiles[options.profileName];
  if (config.mono.defaultProfile === options.profileName) {
    config.mono.defaultProfile = Object.keys(config.mono.profiles).sort()[0] ?? "";
  }

  await store.writeGlobalConfig(config);
  await store.deleteProfileSecret(options.profileName);

  return {
    removed: true,
    nextDefaultProfile: config.mono.defaultProfile,
  };
}

function normalizeBaseURL(value: string): string | undefined {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/u, "");
  } catch {
    return undefined;
  }
}

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(0, page), Math.max(0, totalPages - 1));
}

function truncateButtonLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= PROFILE_BUTTON_LABEL_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, PROFILE_BUTTON_LABEL_MAX_CHARS - 1)}…`;
}

async function readPreferences(cwd: string): Promise<Array<{ senderId: string; language: TelegramDisplayLanguage }>> {
  const store = new MonoConfigStore(cwd);
  const file = await readJsonFile<TelegramModelWizardStoreFile>(resolveModelWizardStorePath(cwd));
  return file?.preferences ?? [];
}

async function ensureTelegramStateDir(cwd: string): Promise<void> {
  await mkdir(resolveTelegramStateDir(cwd), { recursive: true });
}

function resolveTelegramStateDir(cwd: string): string {
  const store = new MonoConfigStore(cwd);
  return join(store.paths.globalStateDir, "telegram");
}

function resolveModelWizardStorePath(cwd: string): string {
  return join(resolveTelegramStateDir(cwd), "model-config.json");
}

export async function resolveTelegramUiLanguage(options: {
  cwd?: string;
  senderId?: string;
  languageCode?: string;
}): Promise<TelegramDisplayLanguage> {
  const senderId = normalizeTelegramUserId(options.senderId);
  if (!senderId) {
    return inferTelegramDisplayLanguage(options.languageCode);
  }

  const stored = (await readPreferences(options.cwd ?? process.cwd())).find((item) => item.senderId === senderId)?.language;
  return stored ?? inferTelegramDisplayLanguage(options.languageCode);
}

export { TELEGRAM_MODEL_PROFILE_NAME };
