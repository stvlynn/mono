import { afterEach, describe, expect, it, vi } from "vitest";
import { HeartbeatWakeController } from "../packages/agent-core/src/heartbeat-wake.js";

describe("heartbeat wake controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces multiple pending wakes and prefers higher-priority triggers", async () => {
    vi.useFakeTimers();
    const handled: string[] = [];
    const controller = new HeartbeatWakeController<void>();
    controller.setHandler(async (trigger) => {
      handled.push(trigger);
      return undefined;
    });

    controller.requestWake({ trigger: "timer", delayMs: 100 });
    controller.requestWake({ trigger: "nudge", delayMs: 100 });
    controller.requestWake({ trigger: "manual", delayMs: 100 });

    await vi.advanceTimersByTimeAsync(100);

    expect(handled).toEqual(["manual"]);
  });

  it("retries after handler failure", async () => {
    vi.useFakeTimers();
    const handled: string[] = [];
    const controller = new HeartbeatWakeController<void>();
    let attempts = 0;
    controller.setHandler(async (trigger) => {
      handled.push(trigger);
      attempts += 1;
      if (attempts === 1) {
        throw new Error("boom");
      }
      return undefined;
    });

    controller.requestWake({ trigger: "timer", delayMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(handled).toEqual(["timer", "retry"]);
  });
});
