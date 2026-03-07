import { describe, expect, it } from "vitest";
import { isBackwardDeleteInput, isForwardDeleteInput } from "../packages/tui/src/input-keys.js";

describe("input key helpers", () => {
  it("treats common terminal backspace sequences as backward delete", () => {
    expect(isBackwardDeleteInput("\u007f", {} as never)).toBe(true);
    expect(isBackwardDeleteInput("\b", {} as never)).toBe(true);
    expect(isBackwardDeleteInput("h", { ctrl: true } as never)).toBe(true);
    expect(isBackwardDeleteInput("", { backspace: true } as never)).toBe(true);
  });

  it("treats delete escape sequence as forward delete", () => {
    expect(isForwardDeleteInput("\u001b[3~", {} as never)).toBe(true);
    expect(isForwardDeleteInput("", { delete: true } as never)).toBe(true);
  });

  it("does not misclassify normal text input as delete", () => {
    expect(isBackwardDeleteInput("a", {} as never)).toBe(false);
    expect(isForwardDeleteInput("a", {} as never)).toBe(false);
  });
});
