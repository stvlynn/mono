export function setMouseTracking(enabled: boolean): void {
  if (!process.stdout.isTTY) {
    return;
  }

  try {
    process.stdout.write(enabled ? "\u001b[?1000h\u001b[?1006h" : "\u001b[?1000l\u001b[?1006l");
  } catch {
    // Best-effort terminal cleanup/setup. Do not block UI lifecycle on mouse tracking failure.
  }
}

export function restoreRawMode(setRawMode?: ((isEnabled: boolean) => void) | undefined): void {
  try {
    setRawMode?.(false);
  } catch {
    // Best-effort shutdown cleanup. Do not block exit on terminal restore failure.
  }
}

export function restoreTerminalState(setRawMode?: ((isEnabled: boolean) => void) | undefined): void {
  restoreRawMode(setRawMode);
  setMouseTracking(false);

  if (process.stdout.isTTY) {
    try {
      process.stdout.write("\u001b[?1049l");
    } catch {
      // Best-effort shutdown cleanup. Do not block exit on terminal restore failure.
    }
  }
}
