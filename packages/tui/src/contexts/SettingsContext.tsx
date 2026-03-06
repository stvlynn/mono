import { createContext, useContext } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { UISettings } from "../types/ui.js";

export interface SettingsContextValue {
  settings: UISettings;
  setSettings: Dispatch<SetStateAction<UISettings>>;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("SettingsContext is not available");
  }
  return value;
}
