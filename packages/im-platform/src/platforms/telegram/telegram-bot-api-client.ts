import { RemoteDispatchError } from "../../errors.js";

interface TelegramApiFailure {
  ok: false;
  description?: string;
  error_code?: number;
}

interface TelegramApiSuccess<Result> {
  ok: true;
  result: Result;
}

type TelegramApiResponse<Result> = TelegramApiFailure | TelegramApiSuccess<Result>;

export class TelegramBotApiClient {
  readonly #botToken: string;
  readonly #baseUrl: string;
  readonly #fetchImpl: typeof fetch;
  readonly #providerId: string;
  readonly #platform: string;

  constructor(options: {
    providerId: string;
    platform: string;
    botToken: string;
    apiBaseUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.#providerId = options.providerId;
    this.#platform = options.platform;
    this.#botToken = options.botToken;
    this.#baseUrl = (options.apiBaseUrl ?? "https://api.telegram.org").replace(/\/$/, "");
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async call<Result>(method: string, body: FormData | Record<string, unknown>): Promise<Result> {
    const response = await this.#fetchImpl(this.#buildUrl(method), this.#buildRequestInit(body));
    const payload = (await response.json()) as TelegramApiResponse<Result>;
    if (!response.ok) {
      const detail = "description" in payload && payload.description ? payload.description : response.statusText;
      throw new RemoteDispatchError(this.#providerId, this.#platform, method, detail, {
        status: response.status,
      });
    }
    if (!payload.ok) {
      throw new RemoteDispatchError(
        this.#providerId,
        this.#platform,
        method,
        payload.description ?? "Telegram API request failed",
        { status: payload.error_code ?? response.status },
      );
    }
    return payload.result;
  }

  async downloadFile(filePath: string): Promise<Uint8Array> {
    const response = await this.#fetchImpl(this.#buildFileUrl(filePath));
    if (!response.ok) {
      throw new RemoteDispatchError(
        this.#providerId,
        this.#platform,
        "downloadFile",
        response.statusText || `HTTP ${response.status}`,
        { status: response.status },
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  #buildUrl(method: string): string {
    return `${this.#baseUrl}/bot${this.#botToken}/${method}`;
  }

  #buildFileUrl(filePath: string): string {
    return `${this.#baseUrl}/file/bot${this.#botToken}/${filePath.replace(/^\/+/u, "")}`;
  }

  #buildRequestInit(body: FormData | Record<string, unknown>): RequestInit {
    if (body instanceof FormData) {
      return {
        method: "POST",
        body,
      };
    }

    return {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    };
  }
}
