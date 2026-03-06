import { createContext, useContext } from "react";
import type { UIState } from "../types/ui.js";

export const UIStateContext = createContext<UIState | null>(null);

export function useUIState(): UIState {
  const value = useContext(UIStateContext);
  if (!value) {
    throw new Error("UIStateContext is not available");
  }
  return value;
}
