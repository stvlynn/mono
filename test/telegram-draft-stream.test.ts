import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramDraftPreviewStream } from "../packages/telegram-control/src/draft-stream.js";

describe("telegram draft preview stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles preview updates and materializes the final reply", async () => {
    const sendDraft = vi.fn(async () => undefined);
    const sendFinal = vi.fn(async () => 321);
    const stream = createTelegramDraftPreviewStream({
      throttleMs: 1000,
      renderText: (text) => ({ text }),
      sendDraft,
      sendFinal,
    });

    stream.update("Hel");
    stream.update("Hello");
    await vi.advanceTimersByTimeAsync(1000);

    expect(sendDraft).toHaveBeenCalledTimes(1);
    expect(sendDraft).toHaveBeenCalledWith(expect.any(Number), "Hello", undefined);

    await expect(stream.materialize("Hello, world")).resolves.toBe(true);

    expect(sendFinal).toHaveBeenCalledWith("Hello, world", undefined);
    expect(sendDraft).toHaveBeenLastCalledWith(expect.any(Number), "");
  });

  it("falls back cleanly when sendMessageDraft is unsupported", async () => {
    const sendDraft = vi.fn(async () => {
      throw new Error("Bad Request: method sendMessageDraft can be used only in private chats");
    });
    const sendFinal = vi.fn(async () => 123);
    const stream = createTelegramDraftPreviewStream({
      throttleMs: 1000,
      renderText: (text) => ({ text }),
      sendDraft,
      sendFinal,
    });

    stream.update("Hello");
    await vi.advanceTimersByTimeAsync(1000);

    expect(sendDraft).toHaveBeenCalledTimes(1);
    await expect(stream.materialize("Hello")).resolves.toBe(false);
    expect(sendFinal).not.toHaveBeenCalled();
  });

  it("clears an active preview without materializing", async () => {
    const sendDraft = vi.fn(async () => undefined);
    const stream = createTelegramDraftPreviewStream({
      throttleMs: 1000,
      renderText: (text) => ({ text }),
      sendDraft,
      sendFinal: async () => undefined,
    });

    stream.update("Preview");
    await vi.advanceTimersByTimeAsync(1000);
    await stream.clear();

    expect(sendDraft).toHaveBeenLastCalledWith(expect.any(Number), "");
  });
});
