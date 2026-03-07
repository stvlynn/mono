import { useCallback, useEffect, useRef } from "react";
import type { DialogInstance, InterruptState } from "../types/ui.js";

export interface InterruptInvocationContext {
  hasInput?: boolean;
  clearInput?: () => void;
}

export interface InterruptSnapshot {
  interrupt: InterruptState;
  isRunning: boolean;
  topDialog?: DialogInstance;
}

export interface InterruptControllerOptions {
  repeatWindowMs?: number;
  getSnapshot: () => InterruptSnapshot;
  setInterruptState: (interrupt: InterruptState) => void;
  setStatus: (status: string) => void;
  abortRun: () => void;
  closeTopDialog: () => void;
  exitApp: () => void;
}

export interface InterruptController {
  handleCtrlC: (context?: InterruptInvocationContext) => Promise<void>;
  clearArming: () => void;
  dispose: () => void;
}

function isExitArmed(interrupt: InterruptState, repeatWindowMs: number, now: number): boolean {
  return (
    interrupt.armedAction === "exit" &&
    typeof interrupt.lastCtrlCAt === "number" &&
    now - interrupt.lastCtrlCAt <= repeatWindowMs
  );
}

export function createInterruptController(options: InterruptControllerOptions): InterruptController {
  const repeatWindowMs = options.repeatWindowMs ?? 600;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  const clearArming = () => {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = undefined;
    }
    options.setInterruptState({});
  };

  const armExit = (hint: string) => {
    const interrupt: InterruptState = {
      armedAction: "exit",
      lastCtrlCAt: Date.now(),
      hint
    };

    if (clearTimer) {
      clearTimeout(clearTimer);
    }

    clearTimer = setTimeout(() => {
      clearTimer = undefined;
      options.setInterruptState({});
    }, repeatWindowMs);

    options.setInterruptState(interrupt);
  };

  const handleCtrlC = async (context: InterruptInvocationContext = {}) => {
    const now = Date.now();
    const snapshot = options.getSnapshot();

    if (isExitArmed(snapshot.interrupt, repeatWindowMs, now)) {
      clearArming();
      options.exitApp();
      return;
    }

    const topDialog = snapshot.topDialog;
    if (topDialog) {
      options.closeTopDialog();
      clearArming();
      options.setStatus(topDialog.type === "approval" ? `Denied ${topDialog.toolName}` : "Closed dialog");
      return;
    }

    if (snapshot.isRunning) {
      options.abortRun();
      armExit("Run cancelled. Press Ctrl+C again to exit.");
      return;
    }

    if (context.hasInput && context.clearInput) {
      context.clearInput();
      armExit("Input cleared. Press Ctrl+C again to exit.");
      return;
    }

    armExit("Press Ctrl+C again to exit.");
  };

  return {
    handleCtrlC,
    clearArming,
    dispose: clearArming
  };
}

export function useInterruptController(options: InterruptControllerOptions): InterruptController {
  const controllerRef = useRef<InterruptController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = createInterruptController(options);
  }

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      controller?.dispose();
    };
  }, []);

  const handleCtrlC = useCallback(
    async (context?: InterruptInvocationContext) => {
      await controllerRef.current?.handleCtrlC(context);
    },
    []
  );

  const clearArming = useCallback(() => {
    controllerRef.current?.clearArming();
  }, []);

  return {
    handleCtrlC,
    clearArming,
    dispose: () => controllerRef.current?.dispose()
  };
}
