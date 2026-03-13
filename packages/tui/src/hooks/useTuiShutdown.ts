import { useCallback, useEffect, useRef } from "react";
import type { Agent } from "@mono/agent-core";
import type { DialogInstance, UIState } from "../types/ui.js";
import { restoreTerminalState } from "../terminal-cleanup.js";

interface UseTuiShutdownOptions {
  agent: Agent;
  setRawMode?: (isEnabled: boolean) => void;
  exit: () => void;
  uiStateRef: React.MutableRefObject<UIState>;
  setUiState: React.Dispatch<React.SetStateAction<UIState>>;
  setInterruptState: (interrupt: UIState["interrupt"]) => void;
}

export function useTuiShutdown(options: UseTuiShutdownOptions) {
  const shutdownTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearShutdownTimer = useCallback(() => {
    if (shutdownTimerRef.current) {
      clearTimeout(shutdownTimerRef.current);
      shutdownTimerRef.current = undefined;
    }
  }, []);

  const resolveOpenDialogs = useCallback((dialogs: DialogInstance[]) => {
    for (const dialog of dialogs) {
      if (dialog.type === "approval") {
        dialog.resolve(false);
      }
    }
  }, []);

  const forceExit = useCallback(() => {
    restoreTerminalState(options.setRawMode);
    process.exit(130);
  }, [options.setRawMode]);

  const requestShutdown = useCallback(async () => {
    if (options.uiStateRef.current.isExiting) {
      return;
    }

    clearShutdownTimer();
    options.setInterruptState({});
    const dialogs = options.uiStateRef.current.dialogs;
    options.setUiState((current) => ({
      ...current,
      isExiting: true,
      dialogs: [],
      waitingCopy: undefined,
      interrupt: {},
      status: "Exiting..."
    }));

    resolveOpenDialogs(dialogs);

    if (options.agent.isRunning()) {
      options.agent.abort();
    }

    restoreTerminalState(options.setRawMode);
    shutdownTimerRef.current = setTimeout(() => {
      forceExit();
    }, 250);
    shutdownTimerRef.current.unref?.();
    options.exit();
  }, [clearShutdownTimer, forceExit, options, resolveOpenDialogs]);

  useEffect(() => {
    return () => {
      clearShutdownTimer();
      restoreTerminalState(options.setRawMode);
    };
  }, [clearShutdownTimer, options.setRawMode]);

  return {
    requestShutdown,
    forceExit,
    clearShutdownTimer
  };
}
