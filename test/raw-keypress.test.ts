import { describe, expect, it } from "vitest";
import { createRawKey, isInsertableInput } from "../packages/tui/src/hooks/useRawKeypress.js";
import { parseKey } from "../packages/tui/src/legacy-compat.js";

describe("raw keypress compatibility", () => {
  it("parses common backspace sequence as backspace", () => {
    expect(parseKey("\u007f")).toBe("backspace");
  });

  it("parses delete escape sequence as delete", () => {
    expect(parseKey("\u001b[3~")).toBe("delete");
  });

  it("does not treat backspace or delete as insertable text", () => {
    expect(isInsertableInput("\u007f", {
      name: "backspace",
      sequence: "\u007f",
      ctrl: false,
      meta: false,
      shift: false,
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      return: false,
      escape: false,
      backspace: true,
      delete: false,
      home: false,
      end: false
    })).toBe(false);

    expect(isInsertableInput("\u001b[3~", {
      name: "delete",
      sequence: "\u001b[3~",
      ctrl: false,
      meta: false,
      shift: false,
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      return: false,
      escape: false,
      backspace: false,
      delete: true,
      home: false,
      end: false
    })).toBe(false);
  });

  it("treats newline as Ctrl+J instead of submit enter", () => {
    const key = createRawKey("\n");

    expect(key.ctrl).toBe(true);
    expect(key.name).toBe("j");
    expect(key.return).toBe(false);
  });

  it("parses common Shift+Enter escape sequences as modified return", () => {
    expect(createRawKey("\u001b[13;2u")).toMatchObject({ shift: true, return: true, name: "return" });
    expect(createRawKey("\u001b[27;2;13~")).toMatchObject({ shift: true, return: true, name: "return" });
  });
});
