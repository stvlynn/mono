import type { PreparedTelegramText } from "@mono/im-platform";

const TELEGRAM_DRAFT_MAX_CHARS = 4096;
const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647;
const DEFAULT_THROTTLE_MS = 1000;
const DRAFT_METHOD_UNAVAILABLE_RE = /(unknown method|method .*not (found|available|supported)|unsupported)/i;
const DRAFT_CHAT_UNSUPPORTED_RE = /(can't be used|can be used only)/i;

let nextDraftId = 0;

export interface TelegramDraftPreviewStream {
  update(text: string): void;
  materialize(finalText: string): Promise<boolean>;
  clear(): Promise<void>;
}

export function createTelegramDraftPreviewStream(params: {
  throttleMs?: number;
  renderText: (text: string) => PreparedTelegramText;
  sendDraft: (draftId: number, text: string, parseMode?: "HTML") => Promise<void>;
  sendFinal: (text: string, parseMode?: "HTML") => Promise<number | undefined>;
  warn?: (message: string) => void;
}): TelegramDraftPreviewStream {
  const draftId = allocateTelegramDraftId();
  const throttleMs = Math.max(250, params.throttleMs ?? DEFAULT_THROTTLE_MS);

  let stopped = false;
  let draftSupported = true;
  let previewSent = false;
  let lastSentAt = 0;
  let latestSnapshot = "";
  let renderedSnapshot: PreparedTelegramText | undefined;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;

  const waitForInFlight = async () => {
    if (inFlight) {
      await inFlight;
    }
  };

  const sendLatestSnapshot = async (): Promise<void> => {
    while (!stopped && draftSupported) {
      const nextSnapshot = latestSnapshot.trimEnd();
      if (!nextSnapshot) {
        renderedSnapshot = undefined;
        return;
      }

      const prepared = params.renderText(nextSnapshot);
      if (!prepared.text.trim()) {
        renderedSnapshot = undefined;
        return;
      }

      if (prepared.text.length > TELEGRAM_DRAFT_MAX_CHARS) {
        draftSupported = false;
        renderedSnapshot = undefined;
        params.warn?.(
          `telegram draft preview stopped (text length ${prepared.text.length} > ${TELEGRAM_DRAFT_MAX_CHARS})`,
        );
        return;
      }

      if (
        renderedSnapshot?.text === prepared.text
        && renderedSnapshot.parseMode === prepared.parseMode
      ) {
        return;
      }

      renderedSnapshot = prepared;
      latestSnapshot = nextSnapshot;
      await params.sendDraft(draftId, prepared.text, prepared.parseMode);
      previewSent = true;
      lastSentAt = Date.now();

      if (latestSnapshot === nextSnapshot) {
        return;
      }
    }
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    while (!stopped && draftSupported) {
      if (inFlight) {
        await inFlight;
        continue;
      }

      const current = sendLatestSnapshot()
        .catch((error) => {
          if (shouldFallbackFromDraftTransport(error)) {
            draftSupported = false;
            params.warn?.(
              "telegram draft preview unavailable; falling back to final-message delivery",
            );
            return;
          }

          draftSupported = false;
          params.warn?.(
            `telegram draft preview failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          if (inFlight === current) {
            inFlight = undefined;
          }
        });
      inFlight = current;
      await current;
      if (!inFlight) {
        return;
      }
    }
  };

  const schedule = () => {
    if (timer || stopped || !draftSupported) {
      return;
    }

    const delay = Math.max(0, throttleMs - (Date.now() - lastSentAt));
    timer = setTimeout(() => {
      void flush();
    }, delay);
  };

  const clearDraft = async () => {
    if (!previewSent) {
      return;
    }

    try {
      await params.sendDraft(draftId, "");
    } catch {
      // Best-effort cleanup only.
    }
  };

  return {
    update(text: string) {
      if (stopped || !draftSupported) {
        return;
      }

      latestSnapshot = text;
      if (!timer && !inFlight && Date.now() - lastSentAt >= throttleMs) {
        void flush();
        return;
      }
      schedule();
    },
    async materialize(finalText: string): Promise<boolean> {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await waitForInFlight();

      if (!previewSent) {
        return false;
      }

      const prepared = params.renderText(finalText.trimEnd());
      if (!prepared.text.trim() || prepared.text.length > TELEGRAM_DRAFT_MAX_CHARS) {
        return false;
      }

      try {
        const messageId = await params.sendFinal(prepared.text, prepared.parseMode);
        if (typeof messageId !== "number") {
          return false;
        }
        await clearDraft();
        return true;
      } catch (error) {
        params.warn?.(
          `telegram draft preview materialize failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    async clear(): Promise<void> {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await waitForInFlight();
      await clearDraft();
    },
  };
}

function allocateTelegramDraftId(): number {
  nextDraftId = nextDraftId >= TELEGRAM_DRAFT_ID_MAX ? 1 : nextDraftId + 1;
  return nextDraftId;
}

function shouldFallbackFromDraftTransport(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);

  if (!/sendMessageDraft/i.test(message)) {
    return false;
  }

  return DRAFT_METHOD_UNAVAILABLE_RE.test(message) || DRAFT_CHAT_UNSUPPORTED_RE.test(message);
}
