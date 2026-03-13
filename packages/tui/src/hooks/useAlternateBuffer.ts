import { useEffect } from "react";

export function isVsCodeTerminal(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.TERM_PROGRAM?.toLowerCase() === "vscode";
}

export function resolveAlternateBufferEnabled(
  requested: boolean,
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  if (!requested) {
    return false;
  }

  if (environment.MONO_FORCE_ALT_BUFFER === "1") {
    return true;
  }

  return !isVsCodeTerminal(environment);
}

export function getDefaultAlternateBufferEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return resolveAlternateBufferEnabled(true, environment);
}

export function useAlternateBuffer(enabled: boolean): void {
  const active = resolveAlternateBufferEnabled(enabled);

  useEffect(() => {
    if (!active || !process.stdout.isTTY) {
      return;
    }

    process.stdout.write("\u001b[?1049h");
    return () => {
      process.stdout.write("\u001b[?1049l");
    };
  }, [active]);
}
