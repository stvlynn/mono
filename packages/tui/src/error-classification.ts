import type { UIState } from "./types/ui.js";

function errorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = (error as { name?: unknown }).name;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "";
}

export function isRecoverableRuntimeError(error: unknown, state: Pick<UIState, "startupState" | "initialized" | "running">): boolean {
  const name = errorName(error);
  const message = errorMessage(error);

  if (name === "XSAIError") {
    return true;
  }

  const looksLikeRuntimeFailure =
    message.includes("Remote sent ")
    || message.includes("Missing API key")
    || message.includes("No adapter found")
    || message.includes("Invalid Authentication")
    || message.includes("catalog transport")
    || message.includes("unsupported transport");

  if (looksLikeRuntimeFailure) {
    return true;
  }

  return state.running || state.startupState === "ready" || state.startupState === "init_failed" || state.initialized;
}
