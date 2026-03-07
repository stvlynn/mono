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

  it("clears input on first Ctrl+C and exits on a quick second press", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: false,
      topDialog: undefined
    };
    const clearInput = vi.fn();
    const exitApp = vi.fn();
    const setInterruptState = vi.fn((interrupt: InterruptState) => {
      state.interrupt = interrupt;
    });
    const controller = createInterruptController({
      getSnapshot: () => state,
      setInterruptState,
      setStatus: vi.fn(),
      abortRun: vi.fn(),
      closeTopDialog: vi.fn(),
      exitApp
    });

    await controller.handleCtrlC({ hasInput: true, clearInput });

    expect(clearInput).toHaveBeenCalledTimes(1);
    expect(state.interrupt.armedAction).toBe("exit");
    expect(state.interrupt.hint).toBe("Input cleared. Press Ctrl+C again to exit.");

    await controller.handleCtrlC();

    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("aborts a running task on first Ctrl+C and exits on the second", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: true,
      topDialog: undefined
    };
    const abortRun = vi.fn(() => {
      state.isRunning = false;
    });
    const exitApp = vi.fn();
    const controller = createInterruptController({
      getSnapshot: () => state,
      setInterruptState: (interrupt) => {
        state.interrupt = interrupt;
      },
      setStatus: vi.fn(),
      abortRun,
      closeTopDialog: vi.fn(),
      exitApp
    });

    await controller.handleCtrlC();

    expect(abortRun).toHaveBeenCalledTimes(1);
    expect(state.interrupt.hint).toBe("Run cancelled. Press Ctrl+C again to exit.");

    state.isRunning = false;
    await controller.handleCtrlC();

    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("prioritizes aborting a running task over clearing draft input", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: true,
      topDialog: undefined
    };
    const clearInput = vi.fn();
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
      exitApp: vi.fn()
    });

    await controller.handleCtrlC({ hasInput: true, clearInput });

    expect(abortRun).toHaveBeenCalledTimes(1);
    expect(clearInput).not.toHaveBeenCalled();
    expect(state.interrupt.hint).toBe("Run cancelled. Press Ctrl+C again to exit.");
  });

  it("closes the top dialog before considering exit arming", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: true,
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
      exitApp: vi.fn()
    });

    await controller.handleCtrlC();

    expect(closeTopDialog).toHaveBeenCalledTimes(1);
    expect(state.interrupt.armedAction).toBeUndefined();
    expect(setStatus).toHaveBeenCalledWith("Denied bash");
  });

  it("expires exit arming after the repeat window", async () => {
    const state = {
      interrupt: {} as InterruptState,
      isRunning: false,
      topDialog: undefined
    };
    const exitApp = vi.fn();
    const controller = createInterruptController({
      getSnapshot: () => state,
      setInterruptState: (interrupt) => {
        state.interrupt = interrupt;
      },
      setStatus: vi.fn(),
      abortRun: vi.fn(),
      closeTopDialog: vi.fn(),
      exitApp
    });

    await controller.handleCtrlC();

    expect(state.interrupt.armedAction).toBe("exit");

    vi.advanceTimersByTime(601);

    expect(state.interrupt.armedAction).toBeUndefined();

    await controller.handleCtrlC();

    expect(exitApp).not.toHaveBeenCalled();
    expect(state.interrupt.hint).toBe("Press Ctrl+C again to exit.");
  });
});
