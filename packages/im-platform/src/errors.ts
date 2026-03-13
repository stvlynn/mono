export type ImPlatformErrorCode =
  | "PROVIDER_NOT_FOUND"
  | "UNSUPPORTED_TARGET"
  | "UNSUPPORTED_CONTENT"
  | "UNSUPPORTED_CAPABILITY"
  | "REMOTE_DISPATCH_FAILED";

export class ImPlatformError extends Error {
  readonly code: ImPlatformErrorCode;
  readonly provider?: string;
  readonly platform?: string;

  constructor(
    code: ImPlatformErrorCode,
    message: string,
    options?: {
      provider?: string;
      platform?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ImPlatformError";
    this.code = code;
    this.provider = options?.provider;
    this.platform = options?.platform;
  }
}

export class ProviderNotFoundError extends ImPlatformError {
  constructor(provider: string) {
    super("PROVIDER_NOT_FOUND", `Dispatch provider not found: ${provider}`, { provider });
    this.name = "ProviderNotFoundError";
  }
}

export class UnsupportedTargetError extends ImPlatformError {
  constructor(provider: string, platform: string, detail: string) {
    super("UNSUPPORTED_TARGET", detail, { provider, platform });
    this.name = "UnsupportedTargetError";
  }
}

export class UnsupportedContentError extends ImPlatformError {
  constructor(provider: string, platform: string, detail: string) {
    super("UNSUPPORTED_CONTENT", detail, { provider, platform });
    this.name = "UnsupportedContentError";
  }
}

export class UnsupportedCapabilityError extends ImPlatformError {
  constructor(provider: string, platform: string, capability: string) {
    super(
      "UNSUPPORTED_CAPABILITY",
      `${platform} provider "${provider}" does not support capability "${capability}"`,
      { provider, platform },
    );
    this.name = "UnsupportedCapabilityError";
  }
}

export class RemoteDispatchError extends ImPlatformError {
  readonly method: string;
  readonly status?: number;

  constructor(
    provider: string,
    platform: string,
    method: string,
    detail: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(
      "REMOTE_DISPATCH_FAILED",
      `Remote dispatch failed for ${platform}/${provider} via ${method}: ${detail}`,
      { provider, platform, cause: options?.cause },
    );
    this.name = "RemoteDispatchError";
    this.method = method;
    this.status = options?.status;
  }
}
