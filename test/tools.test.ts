import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBashTool, createEditTool, DefaultPermissionPolicy } from "../packages/tools/src/index.js";

describe("tools", () => {
  it("requires approval for destructive bash commands", () => {
    const policy = new DefaultPermissionPolicy();
    const decision = policy.evaluate({
      toolName: "bash",
      input: { command: "git reset --hard HEAD~1" },
      cwd: "/tmp/project",
      sessionId: "session"
    });

    expect(decision.type).toBe("ask");
  });

  it("edits a file with an exact match", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-tools-"));
    const filePath = join(cwd, "file.txt");
    await writeFile(filePath, "before value\n", "utf8");

    const tool = createEditTool(cwd);
    const result = await tool.execute(
      { path: "file.txt", oldText: "before", newText: "after" },
      { toolCallId: "tool-1" }
    );

    const contents = await readFile(filePath, "utf8");
    expect(contents).toBe("after value\n");
    expect(result.details?.diff).toContain("-before value");
    expect(result.details?.diff).toContain("+after value");
  });

  it("stores large bash output as a workspace artifact", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-tools-bash-"));
    const tool = createBashTool(cwd);

    const result = await tool.execute(
      { command: "seq 1 10000" },
      { toolCallId: "tool-2" }
    );

    expect(result.details?.truncated).toBe(true);
    expect(result.artifact?.path).toMatch(/^\.mono\/artifacts\/bash-/);
    expect(result.details?.fullOutputPath).toBe(result.artifact?.path);

    const artifactBody = await readFile(join(cwd, result.artifact!.path), "utf8");
    expect(artifactBody).toContain("1\n2\n3");
    expect(artifactBody).toContain("9999\n10000");
  });
});
