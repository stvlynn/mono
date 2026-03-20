import { describe, expect, it } from "vitest";
import { createFallbackModel } from "../packages/config/src/defaults.js";
import type { SessionEntry } from "../packages/shared/src/index.js";
import { repairLinearSessionTranscript } from "../packages/session/src/index.js";

describe("session transcript repair", () => {
  it("repairs a linear transcript with a missing tool result", () => {
    const entries: SessionEntry[] = [
      {
        id: "meta",
        timestamp: 1,
        entryType: "metadata",
        payload: { cwd: "/workspace", model: "MiniMax-M2.7-highspeed", provider: "openai" },
      },
      {
        id: "user-1",
        parentId: "meta",
        timestamp: 2,
        entryType: "user",
        payload: {
          role: "user",
          content: "look it up",
          timestamp: 2,
        },
      },
      {
        id: "assistant-1",
        parentId: "user-1",
        timestamp: 3,
        entryType: "assistant",
        payload: {
          role: "assistant",
          provider: "openai",
          model: "MiniMax-M2.7-highspeed",
          stopReason: "tool_use",
          timestamp: 3,
          content: [
            {
              type: "tool-call",
              id: "call_1",
              name: "read",
              arguments: { path: "README.md" },
            },
          ],
        },
      },
      {
        id: "assistant-2",
        parentId: "assistant-1",
        timestamp: 4,
        entryType: "assistant",
        payload: {
          role: "assistant",
          provider: "openai",
          model: "MiniMax-M2.7-highspeed",
          stopReason: "stop",
          timestamp: 4,
          content: [{ type: "text", text: "fallback answer" }],
        },
      },
    ];

    const repaired = repairLinearSessionTranscript(
      entries,
      createFallbackModel("openai", "MiniMax-M2.7-highspeed", "https://api.minimaxi.com/v1")
    );

    expect(repaired.report.modified).toBe(true);
    expect(repaired.report.addedSyntheticToolResults).toBe(1);
    expect(repaired.entries.map((entry) => entry.entryType)).toEqual([
      "metadata",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });
});
