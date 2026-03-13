import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInterruptController } from "../packages/tui/src/hooks/useInterruptController.js";
import type { InterruptState } from "../packages/tui/src/types/ui.js";

describe("interrupt controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows exit warning on first Ctrl+C and requests shutdown on the second", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: false,
      isExiting: false,
      topDialog: undefined
    };
    let ctrlCPressCount = 0;
    const requestShutdown = vi.fn();
    const setInterruptState = vi.fn((interrupt: InterruptState) => {
      state.interrupt = interrupt;
    });
    const controller = createInterruptController({
      getSnapshot: () => state,
      setInterruptState,
      setStatus: vi.fn(),
      abortRun: vi.fn(),
      closeTopDialog: vi.fn(),
      registerCtrlCPress: () => {
        ctrlCPressCount += 1;
        if (ctrlCPressCount > 1) {
          void requestShutdown();
        }
        return ctrlCPressCount;
      },
      resetCtrlCPress: () => {
        ctrlCPressCount = 0;
      },
      forceExit: vi.fn()
    });

    await controller.handleCtrlC();

    expect(state.interrupt.ctrlCPressedOnce).toBe(true);
    expect(state.interrupt.hint).toBe("Press Ctrl+C again to exit.");

    await controller.handleCtrlC();

    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it("aborts a running task on first Ctrl+C and exits on the second", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: true,
      isExiting: false,
      topDialog: undefined
    };
    const abortRun = vi.fn(() => {
      state.isRunning = false;
    });
    let ctrlCPressCount = 0;
    const requestShutdown = vi.fn();
    const controller = createInterruptController({
      getSnapshot: () => state,
      setInterruptState: (interrupt) => {
        state.interrupt = interrupt;
      },
      setStatus: vi.fn(),
      abortRun,
      closeTopDialog: vi.fn(),
      registerCtrlCPress: () => {
        ctrlCPressCount += 1;
        if (ctrlCPressCount > 1) {
          void requestShutdown();
        }
        return ctrlCPressCount;
      },
      resetCtrlCPress: () => {
        ctrlCPressCount = 0;
      },
      forceExit: vi.fn()
    });

    await controller.handleCtrlC();

    expect(abortRun).toHaveBeenCalledTimes(1);
    expect(state.interrupt.hint).toBe("Run cancelled. Press Ctrl+C again to exit.");

    state.isRunning = false;
    await controller.handleCtrlC();

    expect(requestShutdown).toHaveBeenCalledTimes(1);
  });

  it("prioritizes aborting a running task over clearing draft input", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: true,
      isExiting: false,
      topDialog: undefined
    };
    const abortRun = vi.fn(() => {
      state.isRunning = false;
    });
    const controller = createInterruptController({
      getSnapshot: () => state,
      setInterruptState: (interrupt) => {
        state.interrupt = interrupt;
      },
      setStatus: vi.fn(),
      abortRun,
      closeTopDialog: vi.fn(),
      registerCtrlCPress: vi.fn(() => 1),
      resetCtrlCPress: vi.fn(),
      forceExit: vi.fn()
    });

    await controller.handleCtrlC();

    expect(abortRun).toHaveBeenCalledTimes(1);
    expect(state.interrupt.hint).toBe("Run cancelled. Press Ctrl+C again to exit.");
  });

  it("closes the top dialog before considering exit arming", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: true,
      isExiting: false,
      topDialog: {
        id: "approval-1",
        type: "approval" as const,
        title: "Approve bash",
        toolName: "bash",
        reason: "Need approval",
        input: "{}",
        resolve: vi.fn()
      }
    };
    const setStatus = vi.fn();
    const closeTopDialog = vi.fn(() => {
      state.topDialog = undefined;
    });
    const controller = createInterruptController({
      getSnapshot: () => state,
      setInterruptState: (interrupt) => {
        state.interrupt = interrupt;
      },
      setStatus,
      abortRun: vi.fn(),
      closeTopDialog,
      registerCtrlCPress: vi.fn(() => 1),
      resetCtrlCPress: vi.fn(),
      forceExit: vi.fn()
    });

    await controller.handleCtrlC();

    expect(closeTopDialog).toHaveBeenCalledTimes(1);
    expect(state.interrupt.armedAction).toBeUndefined();
    expect(setStatus).toHaveBeenCalledWith("Denied bash");
  });

  it("does not request shutdown again after the repeated-key state resets", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: false,
      isExiting: false,
      topDialog: undefined
    };
    let ctrlCPressCount = 0;
    const requestShutdown = vi.fn();
    const controller = createInterruptController({
      getSnapshot: () => state,
      setInterruptState: (interrupt) => {
        state.interrupt = interrupt;
      },
      setStatus: vi.fn(),
      abortRun: vi.fn(),
      closeTopDialog: vi.fn(),
      registerCtrlCPress: () => {
        ctrlCPressCount += 1;
        if (ctrlCPressCount > 1) {
          void requestShutdown();
        }
        return ctrlCPressCount;
      },
      resetCtrlCPress: () => {
        ctrlCPressCount = 0;
      },
      forceExit: vi.fn()
    });

    await controller.handleCtrlC();

    expect(state.interrupt.ctrlCPressedOnce).toBe(true);

    ctrlCPressCount = 0;
    state.interrupt = {};

    await controller.handleCtrlC();

    expect(requestShutdown).not.toHaveBeenCalled();
    expect(state.interrupt.hint).toBe("Press Ctrl+C again to exit.");
  });

  it("forces exit immediately when Ctrl+C is pressed during shutdown", async () => {
    const forceExit = vi.fn();
    const controller = createInterruptController({
      getSnapshot: () => ({
        interrupt: {},
        isRunning: false,
        isExiting: true,
        topDialog: undefined
      }),
      setInterruptState: vi.fn(),
      setStatus: vi.fn(),
      abortRun: vi.fn(),
      closeTopDialog: vi.fn(),
      registerCtrlCPress: vi.fn(() => 1),
      resetCtrlCPress: vi.fn(),
      forceExit
    });

    await controller.handleCtrlC();

    expect(forceExit).toHaveBeenCalledTimes(1);
  });
});
