import { describe, expect, it } from "vitest";
import { isRecoverableRuntimeError } from "../packages/tui/src/error-classification.js";

describe("tui error classification", () => {
  it("treats AI transport failures as recoverable runtime errors", () => {
    const error = Object.assign(new Error('Remote sent 401 response: {"error":"Invalid Authentication"}'), {
      name: "AI_APICallError"
    });

    expect(isRecoverableRuntimeError(error, {
      startupState: "ready",
      initialized: true,
      running: true
    })).toBe(true);
  });

  it("treats startup-time unknown failures as non-recoverable by default", () => {
    expect(isRecoverableRuntimeError(new Error("boom"), {
      startupState: "initializing",
      initialized: false,
      running: false
    })).toBe(false);
  });
});
