import { afterEach, describe, expect, it, vi } from "vitest";
import { bindRawKeypressListener, createRawKey, isInsertableInput, splitInputSequences } from "../packages/tui/src/hooks/useRawKeypress.js";
import { parseKey } from "../packages/tui/src/legacy-compat.js";
import { restoreTerminalState } from "../packages/tui/src/terminal-cleanup.js";

describe("raw keypress compatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses common backspace sequence as backspace", () => {
    expect(parseKey("\u007f")).toBe("backspace");
  });

  it("parses delete escape sequence as delete", () => {
    expect(parseKey("\u001b[3~")).toBe("delete");
  });

  it("parses page up and page down escape sequences", () => {
    expect(parseKey("\u001b[5~")).toBe("pageup");
    expect(parseKey("\u001b[6~")).toBe("pagedown");
    expect(createRawKey("\u001b[5~")).toMatchObject({ pageUp: true, name: "pageup" });
    expect(createRawKey("\u001b[6~")).toMatchObject({ pageDown: true, name: "pagedown" });
  });

  it("parses sgr mouse wheel escape sequences", () => {
    expect(createRawKey("\u001b[<64;10;5M")).toMatchObject({ wheelUp: true, name: "wheelup" });
    expect(createRawKey("\u001b[<65;10;5M")).toMatchObject({ wheelDown: true, name: "wheeldown" });
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
      pageUp: false,
      pageDown: false,
      wheelUp: false,
      wheelDown: false,
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
      pageUp: false,
      pageDown: false,
      wheelUp: false,
      wheelDown: false,
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

  it("parses Ctrl+C as a control key with name c", () => {
    const key = createRawKey("\u0003");

    expect(key.ctrl).toBe(true);
    expect(key.name).toBe("c");
    expect(key.return).toBe(false);
  });

  it("parses common Shift+Enter escape sequences as modified return", () => {
    expect(createRawKey("\u001b[13;2u")).toMatchObject({ shift: true, return: true, name: "return" });
    expect(createRawKey("\u001b[27;2;13~")).toMatchObject({ shift: true, return: true, name: "return" });
  });

  it("restores raw mode and removes listeners on cleanup without leaving the alternate buffer", () => {
    const stdin = {
      on: vi.fn(),
      removeListener: vi.fn()
    } as unknown as NodeJS.ReadStream;
    const setRawMode = vi.fn();
    const onKeypress = vi.fn();
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const cleanup = bindRawKeypressListener({
      stdin,
      setRawMode,
      onKeypress
    });

    expect(setRawMode).toHaveBeenCalledWith(true);
    expect(stdin.on).toHaveBeenCalledWith("data", expect.any(Function));
    if (process.stdout.isTTY) {
      expect(writeSpy).toHaveBeenCalledWith("\u001b[?1000h\u001b[?1006h");
    }

    cleanup();

    expect(stdin.removeListener).toHaveBeenCalledWith("data", expect.any(Function));
    expect(setRawMode).toHaveBeenLastCalledWith(false);
    if (process.stdout.isTTY) {
      expect(writeSpy).toHaveBeenCalledWith("\u001b[?1000l\u001b[?1006l");
    }
    expect(writeSpy).not.toHaveBeenCalledWith("\u001b[?1049l");
  });

  it("full terminal restore still exits the alternate buffer", () => {
    const setRawMode = vi.fn();
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    restoreTerminalState(setRawMode);

    expect(setRawMode).toHaveBeenCalledWith(false);
    if (process.stdout.isTTY) {
      expect(writeSpy).toHaveBeenCalledWith("\u001b[?1049l");
    }
  });

  it("splits batched printable input and return into individual sequences", () => {
    expect(splitInputSequences("/model\r")).toEqual(["/", "m", "o", "d", "e", "l", "\r"]);
  });

  it("preserves ANSI escape sequences as a single key event", () => {
    expect(splitInputSequences("\u001b[A")).toEqual(["\u001b[A"]);
    expect(splitInputSequences("a\u001b[Bb")).toEqual(["a", "\u001b[B", "b"]);
  });

  it("emits one callback per logical key when stdin batches input", () => {
    let handleData: ((chunk: Buffer | string) => void) | undefined;
    const stdin = {
      on: vi.fn((event: string, listener: (chunk: Buffer | string) => void) => {
        if (event === "data") {
          handleData = listener;
        }
      }),
      removeListener: vi.fn()
    } as unknown as NodeJS.ReadStream;
    const setRawMode = vi.fn();
    const onKeypress = vi.fn();

    const cleanup = bindRawKeypressListener({
      stdin,
      setRawMode,
      onKeypress
    });

    handleData?.("/model\r");

    expect(onKeypress.mock.calls.map(([input]) => input)).toEqual(["/", "m", "o", "d", "e", "l", "\r"]);
    expect(onKeypress.mock.calls.at(-1)?.[1]).toMatchObject({ return: true, name: "return" });

    cleanup();
  });
});
