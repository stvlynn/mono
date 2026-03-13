const TELEGRAM_MAX = 4096;

export function splitMessage(text: string, threshold: number): string[] {
  if (threshold <= 0 || text.length <= threshold) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > threshold) {
    const window = remaining.slice(0, threshold);
    let cutIndex = -1;

    const paragraphIndex = window.lastIndexOf("\n\n");
    if (paragraphIndex > 0) {
      cutIndex = paragraphIndex + 2;
    }

    if (cutIndex <= 0) {
      const lineIndex = window.lastIndexOf("\n");
      if (lineIndex > 0) {
        cutIndex = lineIndex + 1;
      }
    }

    if (cutIndex <= 0) {
      let lastSentenceEnd = -1;
      for (const match of window.matchAll(/[.。！？!?;；]\s/g)) {
        lastSentenceEnd = match.index + match[0].length;
      }
      if (lastSentenceEnd > 0) {
        cutIndex = lastSentenceEnd;
      }
    }

    if (cutIndex <= 0) {
      cutIndex = threshold;
    }

    const chunk = remaining.slice(0, cutIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(cutIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  const safeChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= TELEGRAM_MAX) {
      safeChunks.push(chunk);
      continue;
    }
    for (let index = 0; index < chunk.length; index += TELEGRAM_MAX) {
      const part = chunk.slice(index, index + TELEGRAM_MAX).trim();
      if (part) {
        safeChunks.push(part);
      }
    }
  }

  return safeChunks;
}
