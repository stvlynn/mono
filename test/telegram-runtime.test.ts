import { readFileSync } from "node:fs";
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

  it("uses sendMessageDraft preview streaming during Telegram chat handoff", () => {
    const source = readFileSync("packages/telegram-control/src/runtime.ts", "utf8");

    expect(source).toContain("createTelegramDraftPreviewStream");
    expect(source).toContain('"sendMessageDraft"');
    expect(source).toContain("preview?.materialize(reply)");
  });
});
