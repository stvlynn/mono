import { createContext, useContext } from "react";
import type { Agent } from "@mono/agent-core";

export interface AppContextValue {
  agent: Agent;
  version: string;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error("AppContext is not available");
  }
  return value;
}
