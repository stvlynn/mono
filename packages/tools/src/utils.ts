import { extname } from "node:path";

export const DEFAULT_MAX_BYTES = 32 * 1024;
export const DEFAULT_MAX_LINES = 250;

export function truncateText(input: string, maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES): string {
  const lines = input.split("\n");
  const sliced = lines.slice(0, maxLines).join("\n");
  if (Buffer.byteLength(sliced, "utf8") <= maxBytes && lines.length <= maxLines) {
    return sliced;
  }

  let output = "";
  for (const line of lines) {
    const next = output ? `${output}\n${line}` : line;
    if (Buffer.byteLength(next, "utf8") > maxBytes) {
      break;
    }
    output = next;
    if (output.split("\n").length >= maxLines) {
      break;
    }
  }

  return `${output}\n\n[truncated]`;
}

export function isImagePath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext);
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size}B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)}KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}
