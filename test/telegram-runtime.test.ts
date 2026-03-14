import { describe, expect, it } from "vitest";
import { isTelegramPollingConflict } from "@mono/telegram-control";

describe("telegram runtime conflict detection", () => {
  it("detects Telegram getUpdates conflict errors", () => {
    const error = new Error("Conflict: terminated by other getUpdates request; make sure that only one bot instance is running");
    expect(isTelegramPollingConflict(error)).toBe(true);
  });

  it("ignores unrelated polling errors", () => {
    const error = new Error("fetch failed");
    expect(isTelegramPollingConflict(error)).toBe(false);
  });
});
