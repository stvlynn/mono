export type HeartbeatWakeTrigger = "timer" | "manual" | "retry" | "nudge";

export interface HeartbeatWakeRequest {
  delayMs?: number;
  trigger: HeartbeatWakeTrigger;
}

export interface HeartbeatWakeControllerOptions {
  onError?: (error: unknown) => void;
  retryDelayMs?: number;
}

type HeartbeatWakeHandler<TResult> = (trigger: HeartbeatWakeTrigger) => Promise<TResult | undefined>;

interface PendingWake {
  priority: number;
  trigger: HeartbeatWakeTrigger;
}

const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_COALESCE_DELAY_MS = 250;

export class HeartbeatWakeController<TResult = void> {
  private readonly onError?: (error: unknown) => void;
  private readonly retryDelayMs: number;
  private handler?: HeartbeatWakeHandler<TResult>;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private timerDueAt?: number;
  private pendingWake?: PendingWake;

  constructor(options: HeartbeatWakeControllerOptions = {}) {
    this.onError = options.onError;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  setHandler(handler: HeartbeatWakeHandler<TResult>): void {
    this.handler = handler;
  }

  requestWake(request: HeartbeatWakeRequest): void {
    this.queuePending(request.trigger);
    this.schedule(request.delayMs ?? DEFAULT_COALESCE_DELAY_MS);
  }

  async runNow(trigger: HeartbeatWakeTrigger): Promise<TResult | undefined> {
    return this.execute(trigger);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.timerDueAt = undefined;
    }
    this.pendingWake = undefined;
  }

  private queuePending(trigger: HeartbeatWakeTrigger): void {
    const next = {
      trigger,
      priority: wakePriority(trigger),
    };
    const current = this.pendingWake;
    if (!current || next.priority >= current.priority) {
      this.pendingWake = next;
    }
  }

  private schedule(delayMs: number): void {
    const delay = Math.max(0, delayMs);
    const dueAt = Date.now() + delay;
    if (this.timer && typeof this.timerDueAt === "number" && this.timerDueAt <= dueAt) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timerDueAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.timerDueAt = undefined;
      const next = this.pendingWake;
      this.pendingWake = undefined;
      if (!next) {
        return;
      }
      void this.execute(next.trigger);
    }, delay);
    this.timer.unref?.();
  }

  private async execute(trigger: HeartbeatWakeTrigger): Promise<TResult | undefined> {
    if (!this.handler) {
      return undefined;
    }
    if (this.running) {
      this.queuePending(trigger);
      this.schedule(this.retryDelayMs);
      return undefined;
    }

    this.running = true;
    try {
      return await this.handler(trigger);
    } catch (error) {
      this.onError?.(error);
      this.queuePending("retry");
      this.schedule(this.retryDelayMs);
      return undefined;
    } finally {
      this.running = false;
      if (this.pendingWake && !this.timer) {
        this.schedule(0);
      }
    }
  }
}

function wakePriority(trigger: HeartbeatWakeTrigger): number {
  switch (trigger) {
    case "manual":
      return 4;
    case "retry":
      return 3;
    case "nudge":
      return 2;
    case "timer":
    default:
      return 1;
  }
}
