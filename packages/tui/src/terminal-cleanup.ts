export function restoreRawMode(setRawMode?: ((isEnabled: boolean) => void) | undefined): void {
  try {
    setRawMode?.(false);
  } catch {
    // Best-effort shutdown cleanup. Do not block exit on terminal restore failure.
  }
}

export function restoreTerminalState(setRawMode?: ((isEnabled: boolean) => void) | undefined): void {
  restoreRawMode(setRawMode);

  if (process.stdout.isTTY) {
    try {
      process.stdout.write("\u001b[?1049l");
    } catch {
      // Best-effort shutdown cleanup. Do not block exit on terminal restore failure.
    }
  }
}
