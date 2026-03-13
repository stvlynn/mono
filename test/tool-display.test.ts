import { describe, expect, it } from "vitest";
import { summarizeToolContent, summarizeToolInput } from "../packages/tui/src/tool-display.js";

describe("tool display formatting", () => {
  it("builds compact summaries for structured tool inputs", () => {
    expect(summarizeToolInput({
      path: "packages/tui/src/components/MainContent.tsx",
      recursive: false,
      limit: 20
    })).toContain("path=");
  });

  it("reduces multiline tool output to a compact summary line", () => {
    expect(summarizeToolContent("first line\nsecond line")).toBe("first line");
  });
});
