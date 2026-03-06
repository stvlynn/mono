const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  );
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function visibleWidth(value: string): number {
  let width = 0;
  for (const char of stripAnsi(value)) {
    if (char === "\n" || char === "\r") {
      continue;
    }
    if (char === "\t") {
      width += 2;
      continue;
    }
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function truncateToWidth(value: string, width: number, suffix = "..."): string {
  if (width <= 0) {
    return "";
  }
  if (visibleWidth(value) <= width) {
    return value;
  }
  const suffixWidth = Math.min(width, visibleWidth(suffix));
  let result = "";
  let currentWidth = 0;
  for (const char of value) {
    const charWidth = visibleWidth(char);
    if (currentWidth + charWidth + suffixWidth > width) {
      break;
    }
    result += char;
    currentWidth += charWidth;
  }
  return result + (suffixWidth > 0 ? truncateToWidth(suffix, width - currentWidth, "") : "");
}

export function padRight(value: string, width: number): string {
  const remainder = Math.max(0, width - visibleWidth(value));
  return value + " ".repeat(remainder);
}

export function wrapText(value: string, width: number): string[] {
  const normalized = value.replace(/\t/g, "  ").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];
  for (const line of normalized.split("\n")) {
    if (line.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const char of line) {
      const next = current + char;
      if (visibleWidth(next) > Math.max(1, width)) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}
