import { createContext, useContext, useEffect } from "react";
import type { RawKey } from "../hooks/useRawKeypress.js";

export type ForegroundKeypressHandler = (input: string, key: RawKey) => void;

export interface ForegroundKeypressRegistry {
  registerForegroundKeypressHandler: (handler: ForegroundKeypressHandler) => () => void;
}

export const ForegroundKeypressContext = createContext<ForegroundKeypressRegistry | null>(null);

export function useForegroundKeypress(handler: ForegroundKeypressHandler, active = true): void {
  const registry = useContext(ForegroundKeypressContext);

  if (!registry) {
    throw new Error("ForegroundKeypressContext is not available");
  }

  useEffect(() => {
    if (!active) {
      return;
    }

    return registry.registerForegroundKeypressHandler(handler);
  }, [active, handler, registry]);
}
