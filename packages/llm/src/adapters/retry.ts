import type { NormalizedProviderError } from "./error.js";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  backoffFactor: 3,
  jitter: 0.1
};

export function computeRetryDelay(
  attempt: number,
  error: NormalizedProviderError,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): number {
  const headers = error.responseHeaders;
  const retryAfterMs = headers?.["retry-after-ms"];
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.min(parsed, policy.maxDelayMs);
    }
  }

  const retryAfter = headers?.["retry-after"];
  if (retryAfter) {
    const parsedSeconds = Number.parseFloat(retryAfter);
    if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
      return Math.min(Math.ceil(parsedSeconds * 1000), policy.maxDelayMs);
    }
  }

  const raw = policy.baseDelayMs * Math.pow(policy.backoffFactor, Math.max(0, attempt - 1));
  const bounded = Math.min(raw, policy.maxDelayMs);
  const jitterFactor = 1 + ((Math.random() * 2 - 1) * policy.jitter);
  return Math.max(0, Math.round(bounded * jitterFactor));
}
