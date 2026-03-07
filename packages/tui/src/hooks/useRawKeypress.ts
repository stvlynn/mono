import { useEffect } from "react";
import { useStdin } from "ink";
import { parseKey } from "../legacy-compat.js";

export interface RawKey {
  name: string;
  sequence: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  backspace: boolean;
  delete: boolean;
  home: boolean;
  end: boolean;
}

function createEmptyRawKey(sequence: string): RawKey {
  return {
    name: "",
    sequence,
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
    delete: false,
    home: false,
    end: false
  };
}

function resolveModifiedSpecialKey(sequence: string): RawKey | null {
  if (sequence === "\n") {
    return {
      ...createEmptyRawKey(sequence),
      name: "j",
      ctrl: true
    };
  }

  if (sequence === "\u001b[13;2u" || sequence === "\u001b[27;2;13~") {
    return {
      ...createEmptyRawKey(sequence),
      name: "return",
      shift: true,
      return: true
    };
  }

  return null;
}

export function createRawKey(sequence: string): RawKey {
  const modifiedSpecialKey = resolveModifiedSpecialKey(sequence);
  if (modifiedSpecialKey) {
    return modifiedSpecialKey;
  }

  const parsed = parseKey(sequence);
  const key: RawKey = {
    ...createEmptyRawKey(sequence),
    name: typeof parsed === "string" ? parsed : ""
  };

  switch (parsed) {
    case "up":
      key.name = "up";
      key.upArrow = true;
      return key;
    case "down":
      key.name = "down";
      key.downArrow = true;
      return key;
    case "left":
      key.name = "left";
      key.leftArrow = true;
      return key;
    case "right":
      key.name = "right";
      key.rightArrow = true;
      return key;
    case "enter":
      key.name = "return";
      key.return = true;
      return key;
    case "escape":
      key.name = "escape";
      key.escape = true;
      return key;
    case "backspace":
      key.name = "backspace";
      key.backspace = true;
      return key;
    case "delete":
      key.name = "delete";
      key.delete = true;
      return key;
    case "home":
      key.name = "home";
      key.home = true;
      return key;
    case "end":
      key.name = "end";
      key.end = true;
      return key;
    default:
      break;
  }

  if (typeof parsed === "string" && parsed.startsWith("ctrl+")) {
    key.name = parsed.slice(5);
    key.ctrl = true;
    return key;
  }

  if (typeof parsed === "string" && parsed.startsWith("alt+")) {
    key.name = parsed.slice(4);
    key.meta = true;
    return key;
  }

  return key;
}

export function useRawKeypress(
  onKeypress: (input: string, key: RawKey) => void,
  options: { isActive: boolean }
): void {
  const { stdin, setRawMode } = useStdin();

  useEffect(() => {
    if (!options.isActive) {
      return;
    }

    setRawMode?.(true);

    const handleData = (chunk: Buffer | string) => {
      const input = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      onKeypress(input, createRawKey(input));
    };

    stdin.on("data", handleData);
    return () => {
      stdin.removeListener("data", handleData);
    };
  }, [onKeypress, options.isActive, setRawMode, stdin]);
}

export function isInsertableInput(input: string, key: RawKey): boolean {
  if (!input || key.ctrl || key.meta) {
    return false;
  }

  return !(
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.return ||
    key.escape ||
    key.backspace ||
    key.delete ||
    key.home ||
    key.end
  );
}
