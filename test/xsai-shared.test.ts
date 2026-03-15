import { describe, expect, it } from "vitest";
import { normalizeProviderError } from "../packages/llm/src/adapters/error.js";
import { shouldRetryXsaiError } from "../packages/llm/src/adapters/xsai-shared.js";

describe("xsai retry classification", () => {
  it("retries protocol and transport errors", () => {
    const protocolError = new TypeError("fetch failed", {
      cause: new Error("Response does not match the HTTP/1.1 protocol (Expected HTTP/, RTSP/ or ICE/)")
    });
    const socketError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })
    });

    expect(shouldRetryXsaiError(protocolError)).toBe(true);
    expect(shouldRetryXsaiError(socketError)).toBe(true);
  });

  it("retries retryable remote HTTP errors but not auth failures", () => {
    expect(shouldRetryXsaiError(new Error("Remote sent 500 response: upstream error"))).toBe(true);
    expect(shouldRetryXsaiError(new Error("Remote sent 429 response: rate limited"))).toBe(true);
    expect(shouldRetryXsaiError(new Error("Remote sent 401 response: invalid api key"))).toBe(false);
  });

  it("does not retry aborts", () => {
    const abort = new DOMException("Aborted", "AbortError");

    expect(shouldRetryXsaiError(abort)).toBe(false);
  });

  it("normalizes protocol errors as retryable transport errors", () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("Response does not match the HTTP/1.1 protocol (Expected HTTP/, RTSP/ or ICE/)")
    });

    expect(normalizeProviderError(error)).toMatchObject({
      kind: "transport_error",
      retryable: true
    });
  });

  it("normalizes auth and overflow errors distinctly", () => {
    expect(normalizeProviderError(new Error("Remote sent 401 response: invalid api key"))).toMatchObject({
      kind: "auth_error",
      retryable: false,
      statusCode: 401
    });
    expect(normalizeProviderError(new Error("context window exceeds limit"))).toMatchObject({
      kind: "context_overflow",
      retryable: false
    });
  });
});
