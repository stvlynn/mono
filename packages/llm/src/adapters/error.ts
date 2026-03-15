export type ProviderErrorKind =
  | "transport_error"
  | "http_error"
  | "context_overflow"
  | "auth_error"
  | "quota_error"
  | "provider_error";

export interface NormalizedProviderError {
  kind: ProviderErrorKind;
  message: string;
  retryable: boolean;
  statusCode?: number;
  code?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  metadata?: Record<string, string>;
}

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPROTO",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED"
]);

const OVERFLOW_PATTERNS = [
  /context window exceeds limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /context window/i,
  /maximum context length/i,
  /prompt is too long/i,
  /request entity too large/i,
  /413/i
];

export function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (!cause || cause === error) {
    return undefined;
  }
  return readErrorCode(cause);
}

export function readErrorCauseMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return cause.message;
  }
  if (cause && typeof cause === "object") {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return undefined;
}

function parseStatusCode(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^remote sent (\d{3}) response:/i);
  if (!match) {
    return undefined;
  }
  const status = Number.parseInt(match[1] ?? "", 10);
  return Number.isNaN(status) ? undefined : status;
}

function messageIncludes(error: unknown, matcher: (message: string) => boolean): boolean {
  if (error instanceof Error && matcher(error.message.toLowerCase())) {
    return true;
  }
  if (error && typeof error === "object" && "cause" in error) {
    return messageIncludes((error as { cause?: unknown }).cause, matcher);
  }
  return false;
}

export function normalizeProviderError(error: unknown): NormalizedProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const code = readErrorCode(error);
  const statusCode = parseStatusCode(error);
  const causeMessage = readErrorCauseMessage(error);
  const normalizedMessage = causeMessage && causeMessage !== message
    ? `${message}: ${causeMessage}`
    : message;

  if (OVERFLOW_PATTERNS.some((pattern) => pattern.test(normalizedMessage))) {
    return {
      kind: "context_overflow",
      message: normalizedMessage,
      retryable: false,
      code,
      statusCode
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      kind: "auth_error",
      message: normalizedMessage,
      retryable: false,
      code,
      statusCode
    };
  }

  if (statusCode === 429) {
    return {
      kind: "quota_error",
      message: normalizedMessage,
      retryable: true,
      code,
      statusCode
    };
  }

  if (statusCode && statusCode >= 500) {
    return {
      kind: "http_error",
      message: normalizedMessage,
      retryable: true,
      code,
      statusCode
    };
  }

  if (
    (code && RETRYABLE_NETWORK_CODES.has(code))
    || messageIncludes(error, (value) =>
      value.includes("fetch failed")
      || value.includes("response does not match the http/1.1 protocol")
      || value.includes("socket hang up")
      || value.includes("incomplete json segment")
    )
  ) {
    return {
      kind: "transport_error",
      message: normalizedMessage,
      retryable: true,
      code,
      statusCode
    };
  }

  return {
    kind: statusCode ? "http_error" : "provider_error",
    message: normalizedMessage,
    retryable: false,
    code,
    statusCode
  };
}
