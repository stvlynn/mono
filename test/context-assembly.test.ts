import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultContextConfig, createDefaultMemoryConfig } from "../packages/config/src/defaults.js";
import { assemblePromptContext } from "../packages/agent-core/src/context-assembly.js";
import type { ResolvedMonoConfig, UnifiedModel } from "../packages/shared/src/index.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

const model: UnifiedModel = {
  provider: "openai",
  modelId: "gpt-4.1-mini",
  family: "openai-compatible",
  transport: "openai-compatible",
  baseURL: "https://api.openai.com/v1",
  supportsTools: true,
  supportsReasoning: true
};

function createResolvedConfig(): ResolvedMonoConfig {
  return {
    profileName: "default",
    model,
    memory: createDefaultMemoryConfig(),
    context: createDefaultContextConfig(),
    source: {
      profile: "builtin",
      apiKey: "none"
    }
  };
}

describe("context assembly", () => {
  it("builds layered sections and reports bootstrap file usage", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-context-assembly-"));
    tempPaths.push(cwd);

    await mkdir(join(cwd, ".mono"), { recursive: true });
    await mkdir(join(cwd, "docs", "getting-started"), { recursive: true });
    await mkdir(join(cwd, "docs", "architecture"), { recursive: true });
    await writeFile(join(cwd, ".mono", "IDENTITY.md"), "Project identity rules.", "utf8");
    await writeFile(join(cwd, ".mono", "CONTEXT.md"), "Repository map.", "utf8");
    await writeFile(join(cwd, ".mono", "MEMORY.md"), "Long-lived repo memory.", "utf8");
    await writeFile(join(cwd, "README.md"), "Workspace readme.", "utf8");
    await writeFile(join(cwd, "docs", "getting-started", "repo-overview.md"), "Overview doc.", "utf8");
    await writeFile(join(cwd, "docs", "architecture", "system-overview.md"), "Architecture doc.", "utf8");

    const result = await assemblePromptContext({
      cwd,
      sessionId: "session-123",
      sessionStartedAt: Date.UTC(2026, 2, 14, 9, 0, 0),
      profileName: "default",
      model,
      thinkingLevel: "medium",
      verificationMode: "light",
      autoApprove: false,
      config: createResolvedConfig(),
      taskContext: "<TaskContext>Task body</TaskContext>",
      memoryContext: "<MemoryContext>Memory body</MemoryContext>",
      skillsContext: "<ProjectSkills>Skill body</ProjectSkills>",
      memoryPlan: {
        rootIds: [],
        compactedIds: [],
        rawPairIds: [],
        selectedIds: ["memory-a"]
      },
      now: Date.UTC(2026, 2, 14, 10, 30, 0)
    });

    expect(result.systemPrompt).toContain("## Operator Identity");
    expect(result.systemPrompt).toContain("## Runtime Context");
    expect(result.systemPrompt).toContain("## Project Context");
    expect(result.systemPrompt).toContain("<MemoryContext>Memory body</MemoryContext>");
    expect(result.report.sections.map((section) => section.title)).toEqual([
      "Operator Identity",
      "Project Identity",
      "Runtime Context",
      "Task Context",
      "Memory Context",
      "Skills Context",
      "Docs Context",
      "Project Context"
    ]);
    expect(result.report.bootstrapFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ".mono/IDENTITY.md", status: "skipped" }),
        expect.objectContaining({ path: ".mono/MEMORY.md", status: "included" }),
        expect.objectContaining({ path: "README.md", status: "included" })
      ])
    );
    expect(result.report.memory.bootstrapMemoryIncluded).toBe(true);
    expect(result.report.memory.retrievedMemoryIds).toEqual(["memory-a"]);
  });
});
