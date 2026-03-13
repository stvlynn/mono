import { afterEach, describe, expect, it, vi } from "vitest";

const runProcess = vi.fn();

vi.mock("../packages/seekdb-adapter/src/process.js", () => ({
  runProcess
}));

afterEach(() => {
  runProcess.mockReset();
  vi.resetModules();
});

describe("SeekDB python embedded runner", () => {
  it("surfaces structured bridge errors instead of generic subprocess failures", async () => {
    runProcess.mockRejectedValue(
      Object.assign(new Error("Command failed"), {
        stdout: JSON.stringify({
          ok: false,
          error: "Cannot import seekdb module"
        }),
        stderr: ""
      })
    );

    const { SeekDbPythonEmbeddedRunner } = await import("../packages/seekdb-adapter/src/python-embedded-runner.js");
    const runner = new SeekDbPythonEmbeddedRunner({
      pythonExecutable: "python3",
      pythonModule: "seekdb",
      embeddedPath: "/tmp/seekdb"
    });

    await expect(runner.queryRows("SELECT 1")).rejects.toThrow("Cannot import seekdb module");
  });
});
