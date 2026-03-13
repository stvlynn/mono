import { createContext, useContext } from "react";

export interface UIActions {
  submitPrompt: (prompt: string) => Promise<void>;
  handleInterrupt: () => Promise<void>;
  clearInterruptArming: () => void;
  openHelp: () => void;
  openSettings: () => void;
  openAuthInfo: () => void;
  openConnectDialog: (initialFilter?: string) => Promise<void>;
  openModelDialog: (initialFilter?: string) => Promise<void>;
  openProfileDialog: (initialFilter?: string) => Promise<void>;
  openSessionDialog: (initialFilter?: string) => Promise<void>;
  openSkillsDialog: (initialFilter?: string) => Promise<void>;
  openContextDialog: () => Promise<void>;
  openMemoryDialog: (initialFilter?: string) => Promise<void>;
  openTreeDialog: (initialFilter?: string) => Promise<void>;
  closeTopDialog: () => void;
  dismissFatalError: () => void;
  requestShutdown: () => Promise<void>;
  setStatus: (status: string) => void;
  scrollHistoryLineUp: () => void;
  scrollHistoryLineDown: () => void;
  scrollHistoryPageUp: () => void;
  scrollHistoryPageDown: () => void;
  scrollHistoryToTop: () => void;
  scrollHistoryToBottom: () => void;
  toggleCleanUi: () => void;
  toggleAssistantMarkdown: () => void;
  toggleThinkingVisibility: () => void;
  toggleToolDetails: () => void;
}

export const UIActionsContext = createContext<UIActions | null>(null);

export function useUIActions(): UIActions {
  const value = useContext(UIActionsContext);
  if (!value) {
    throw new Error("UIActionsContext is not available");
  }
  return value;
}
