import { assertImmediateDelivery, assertSupportedTelegramContent, assertSupportedTelegramTarget, isSupportedTelegramContent, isSupportedTelegramTarget } from "./telegram-capabilities.js";
import { TelegramBotApiClient } from "./telegram-bot-api-client.js";
import { normalizeTelegramIncomingMessage } from "./telegram-incoming.js";
import { mapTelegramDispatchRequest } from "./telegram-request-mapper.js";
import type { TelegramPlatformAdapterConfig } from "./types.js";
import type { DispatchContent, DispatchRequest, DispatchResult, DispatchTarget, ImPlatformProvider } from "../../types.js";
import { RemoteDispatchError } from "../../errors.js";

interface TelegramMessageEnvelope {
  message_id: number | string;
  chat: {
    id: number | string;
  };
}

export class TelegramPlatformAdapter implements ImPlatformProvider {
  readonly id: string;
  readonly platform = "telegram";
  readonly #client: TelegramBotApiClient;
  readonly #config: TelegramPlatformAdapterConfig;

  constructor(config: TelegramPlatformAdapterConfig) {
    this.#config = config;
    this.id = config.id;
    this.#client = new TelegramBotApiClient({
      providerId: config.id,
      platform: this.platform,
      botToken: config.botToken,
      apiBaseUrl: config.apiBaseUrl,
      fetchImpl: config.fetchImpl,
    });
  }

  supportsTarget(target: DispatchTarget): boolean {
    return isSupportedTelegramTarget(target);
  }

  supportsContent(content: DispatchContent): boolean {
    return isSupportedTelegramContent(content);
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    assertImmediateDelivery(this.id, this.platform, request.options?.deliveryMode);
    assertSupportedTelegramTarget(this.id, this.platform, request.target);
    assertSupportedTelegramContent(this.id, this.platform, request.content);

    const operations = mapTelegramDispatchRequest({
      target: request.target,
      content: request.content,
      options: request.options,
      defaultTextFormat: this.#config.defaultTextFormat,
      defaultDisableNotification: this.#config.defaultDisableNotification,
    });

    const rawResults: unknown[] = [];
    const remoteMessageIds: string[] = [];
    let remoteChatId = "";

    for (const operation of operations) {
      const result = await this.#sendOperation(operation);
      rawResults.push(result);
      const envelopes = normalizeTelegramEnvelopes(result, operation.expectCollection ?? false);
      if (!remoteChatId && envelopes[0]) {
        remoteChatId = String(envelopes[0].chat.id);
      }
      for (const envelope of envelopes) {
        remoteMessageIds.push(String(envelope.message_id));
      }
    }

    return {
      provider: this.id,
      platform: this.platform,
      remoteChatId,
      remoteMessageIds,
      raw: rawResults.length === 1 ? rawResults[0] : rawResults,
    };
  }

  async normalizeIncomingMessage(payload: unknown) {
    return normalizeTelegramIncomingMessage({
      providerId: this.id,
      platform: this.platform,
      client: this.#client,
      payload,
    });
  }

  async #sendOperation(operation: ReturnType<typeof mapTelegramDispatchRequest>[number]): Promise<unknown> {
    try {
      return await this.#client.call(operation.method, operation.body);
    } catch (error) {
      if (!operation.fallbackText || operation.body instanceof FormData) {
        throw error;
      }
      if (!(error instanceof RemoteDispatchError)) {
        throw error;
      }
      const fallbackBody: Record<string, unknown> = {
        ...operation.body,
        text: operation.fallbackText,
      };
      delete fallbackBody.parse_mode;
      return this.#client.call(operation.method, fallbackBody);
    }
  }
}

export function createTelegramPlatformAdapter(config: TelegramPlatformAdapterConfig): TelegramPlatformAdapter {
  return new TelegramPlatformAdapter(config);
}

function normalizeTelegramEnvelopes(result: unknown, expectCollection: boolean): TelegramMessageEnvelope[] {
  if (expectCollection) {
    if (!Array.isArray(result)) {
      throw new Error("Telegram media group response must be an array");
    }
    return result as TelegramMessageEnvelope[];
  }
  return [result as TelegramMessageEnvelope];
}
