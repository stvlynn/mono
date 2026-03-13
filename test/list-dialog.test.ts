import { describe, expect, it } from "vitest";
import { getVisibleListWindow } from "../packages/tui/src/components/ListDialog.js";

describe("ListDialog windowing", () => {
  it("keeps the selection visible once it moves past the first 12 items", () => {
    expect(getVisibleListWindow(0, 20)).toEqual({ start: 0, end: 12 });
    expect(getVisibleListWindow(11, 20)).toEqual({ start: 0, end: 12 });
    expect(getVisibleListWindow(12, 20)).toEqual({ start: 1, end: 13 });
    expect(getVisibleListWindow(19, 20)).toEqual({ start: 8, end: 20 });
  });

  it("clamps safely for short lists", () => {
    expect(getVisibleListWindow(0, 0)).toEqual({ start: 0, end: 12 });
    expect(getVisibleListWindow(2, 3)).toEqual({ start: 0, end: 12 });
  });
});
