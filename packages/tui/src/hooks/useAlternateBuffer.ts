import { useEffect } from "react";

export function useAlternateBuffer(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !process.stdout.isTTY) {
      return;
    }

    process.stdout.write("\u001b[?1049h");
    return () => {
      process.stdout.write("\u001b[?1049l");
    };
  }, [enabled]);
}
