export type KeyId =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "escape"
  | "backspace"
  | "delete"
  | "tab"
  | "home"
  | "end"
  | `ctrl+${string}`
  | `alt+${string}`
  | string;

export function parseKey(data: string): KeyId {
  switch (data) {
    case "\u001b[A":
      return "up";
    case "\u001b[B":
      return "down";
    case "\u001b[C":
      return "right";
    case "\u001b[D":
      return "left";
    case "\u001b[3~":
      return "delete";
    case "\u001b[H":
    case "\u001bOH":
      return "home";
    case "\u001b[F":
    case "\u001bOF":
      return "end";
    case "\r":
    case "\n":
      return "enter";
    case "\u007f":
    case "\b":
      return "backspace";
    case "\t":
      return "tab";
    case "\u001b":
      return "escape";
    default:
      break;
  }

  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      return `ctrl+${String.fromCharCode(code + 96)}`;
    }
    return data;
  }

  if (data.startsWith("\u001b") && data.length === 2) {
    return `alt+${data[1]}`;
  }

  return data;
}

export function matchesKey(data: string, key: KeyId): boolean {
  return parseKey(data) === key;
}
