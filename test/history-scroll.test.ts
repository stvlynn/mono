import { describe, expect, it } from "vitest";
import { clampHistoryScrollOffset, getHistoryWindow, getMaxHistoryScrollOffset } from "../packages/tui/src/history-scroll.js";

describe("history scroll helpers", () => {
  it("clamps history scroll offsets to the available range", () => {
    expect(getMaxHistoryScrollOffset(3, 6)).toBe(0);
    expect(getMaxHistoryScrollOffset(10, 6)).toBe(4);
    expect(clampHistoryScrollOffset(-1, 10, 6)).toBe(0);
    expect(clampHistoryScrollOffset(99, 10, 6)).toBe(4);
  });

  it("returns the visible history window from the bottom-oriented offset", () => {
    expect(getHistoryWindow(10, 0, 6)).toEqual({
      start: 4,
      end: 10,
      hiddenAbove: 4,
      hiddenBelow: 0
    });

    expect(getHistoryWindow(10, 4, 6)).toEqual({
      start: 0,
      end: 6,
      hiddenAbove: 0,
      hiddenBelow: 4
    });
  });
});
