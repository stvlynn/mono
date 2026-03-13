import { describe, expect, it } from "vitest";
import { getDefaultAlternateBufferEnabled, resolveAlternateBufferEnabled } from "../packages/tui/src/hooks/useAlternateBuffer.js";

describe("alternate buffer defaults", () => {
  it("disables alternate buffer by default in the VS Code terminal", () => {
    expect(getDefaultAlternateBufferEnabled({ TERM_PROGRAM: "vscode" } as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveAlternateBufferEnabled(true, { TERM_PROGRAM: "vscode" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("allows explicitly forcing alternate buffer back on", () => {
    expect(resolveAlternateBufferEnabled(true, {
      TERM_PROGRAM: "vscode",
      MONO_FORCE_ALT_BUFFER: "1"
    } as NodeJS.ProcessEnv)).toBe(true);
  });
});
