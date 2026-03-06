import { describe, expect, it } from "vitest";
import { InputBuffer } from "../packages/tui/src/input-buffer.js";

describe("InputBuffer", () => {
  it("inserts and edits around the cursor", () => {
    const buffer = new InputBuffer();

    buffer.insert("hello");
    buffer.moveLeft();
    buffer.moveLeft();
    buffer.insert("X");
    buffer.deleteForward();

    expect(buffer.text).toBe("helXo");
    expect(buffer.cursor).toBe(4);
  });

  it("navigates history without losing empty reset behavior", () => {
    const buffer = new InputBuffer();

    buffer.recordHistory("first");
    buffer.recordHistory("second");

    expect(buffer.navigateHistory("up")).toBe("second");
    expect(buffer.navigateHistory("up")).toBe("first");
    expect(buffer.navigateHistory("down")).toBe("second");
    expect(buffer.navigateHistory("down")).toBe("");
    expect(buffer.navigateHistory("down")).toBeNull();
  });

  it("clears content and history cursor independently", () => {
    const buffer = new InputBuffer();

    buffer.recordHistory("saved");
    buffer.insert("draft");
    buffer.clear();

    expect(buffer.text).toBe("");
    expect(buffer.cursor).toBe(0);
    expect(buffer.navigateHistory("up")).toBe("saved");
  });
});
