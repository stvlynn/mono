import { useCallback, useEffect, useRef } from "react";
import type { DialogInstance, InterruptState } from "../types/ui.js";

export interface InterruptSnapshot {
  interrupt: InterruptState;
  isRunning: boolean;
  isExiting: boolean;
  topDialog?: DialogInstance;
}

export interface InterruptControllerOptions {
  getSnapshot: () => InterruptSnapshot;
  setInterruptState: (interrupt: InterruptState) => void;
  setStatus: (status: string) => void;
  abortRun: () => void;
  closeTopDialog: () => void;
  registerCtrlCPress: () => number;
  resetCtrlCPress: () => void;
  forceExit: () => void;
}

export interface InterruptController {
  handleCtrlC: () => Promise<void>;
  clearArming: () => void;
  dispose: () => void;
}

export function createInterruptController(options: InterruptControllerOptions): InterruptController {
  const clearArming = () => {
    options.resetCtrlCPress();
    options.setInterruptState({});
  };

  const handleCtrlC = async () => {
    const snapshot = options.getSnapshot();
    const wasRunning = snapshot.isRunning;

    if (snapshot.isExiting) {
      options.forceExit();
      return;
    }

    const topDialog = snapshot.topDialog;
    if (topDialog) {
      options.closeTopDialog();
      clearArming();
      options.setStatus(topDialog.type === "approval" ? `Denied ${topDialog.toolName}` : "Closed dialog");
      return;
    }

    if (wasRunning) {
      options.abortRun();
    }

    const count = options.registerCtrlCPress();
    if (count > 1) {
      return;
    }

    const hint = wasRunning
      ? "Run cancelled. Press Ctrl+C again to exit."
      : "Press Ctrl+C again to exit.";

    options.setInterruptState({
      ctrlCPressedOnce: true,
      hint
    });
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

  const handleCtrlC = useCallback(async () => {
    await controllerRef.current?.handleCtrlC();
  }, []);

  const clearArming = useCallback(() => {
    controllerRef.current?.clearArming();
  }, []);

  return {
    handleCtrlC,
    clearArming,
    dispose: () => controllerRef.current?.dispose()
  };
}
