import { createContext, useContext } from "react";

export interface UIActions {
  submitPrompt: (prompt: string) => Promise<void>;
  handleInterrupt: (context?: { hasInput?: boolean; clearInput?: () => void }) => Promise<void>;
  clearInterruptArming: () => void;
  openHelp: () => void;
  openSettings: () => void;
  openAuthInfo: () => void;
  openModelDialog: (initialFilter?: string) => Promise<void>;
  openProfileDialog: (initialFilter?: string) => Promise<void>;
  openSessionDialog: (initialFilter?: string) => Promise<void>;
  openMemoryDialog: (initialFilter?: string) => Promise<void>;
  openTreeDialog: (initialFilter?: string) => Promise<void>;
  closeTopDialog: () => void;
  exitApp: () => void;
  setStatus: (status: string) => void;
  toggleCleanUi: () => void;
}

export const UIActionsContext = createContext<UIActions | null>(null);

export function useUIActions(): UIActions {
  const value = useContext(UIActionsContext);
  if (!value) {
    throw new Error("UIActionsContext is not available");
  }
  return value;
}
