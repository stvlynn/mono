import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultContextConfig, createDefaultMemoryConfig, createDefaultSettingsConfig } from "../packages/config/src/defaults.js";
import { assemblePromptContext } from "../packages/agent-core/src/context-assembly.js";
import type { ResolvedMonoConfig, UnifiedModel } from "../packages/shared/src/index.js";
import { createTestUnifiedModel, describeIfRealTestModel } from "./helpers/test-model-env.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

const model: UnifiedModel = createTestUnifiedModel();

function createResolvedConfig(): ResolvedMonoConfig {
  return {
    profileName: "default",
    model,
    settings: createDefaultSettingsConfig(),
    memory: createDefaultMemoryConfig(),
    context: createDefaultContextConfig(),
    channels: {
      telegram: {
        enabled: false,
        allowFrom: [],
        groupAllowFrom: [],
        groups: {},
        approval: {
          allowChats: [],
          commandDenylist: [],
        },
        reply: {
          multiMessage: true,
          splitDelayMs: 800,
          stickers: {
            enabled: true,
            storePath: ".mono/telegram/stickers.json",
          },
        },
        dmPolicy: "pairing",
        pollingTimeoutSeconds: 20,
      },
    },
    source: {
      profile: "builtin",
      apiKey: "none"
    }
  };
}

function createResolvedConfigWithBootstrapOverrides(
  overrides: Partial<ResolvedMonoConfig["context"]["bootstrap"]>
): ResolvedMonoConfig {
  const config = createResolvedConfig();
  return {
    ...config,
    context: {
      ...config.context,
      bootstrap: {
        ...config.context.bootstrap,
        ...overrides,
      }
    }
  };
}

describeIfRealTestModel("context assembly", () => {
  it("builds layered sections and reports bootstrap file usage", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-context-assembly-"));
    tempPaths.push(cwd);

    await mkdir(join(cwd, ".mono"), { recursive: true });
    await mkdir(join(cwd, "docs", "getting-started"), { recursive: true });
    await mkdir(join(cwd, "docs", "architecture"), { recursive: true });
    await writeFile(join(cwd, "AGENTS.md"), "Repository agent guide.", "utf8");
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
    expect(result.systemPrompt).toContain("## Agent Guide");
    expect(result.systemPrompt).toContain("## Runtime Context");
    expect(result.systemPrompt).toContain("## Project Context");
    expect(result.systemPrompt).toContain("<MemoryContext>Memory body</MemoryContext>");
    expect(result.report.sections.map((section) => section.title)).toEqual([
      "Operator Identity",
      "Agent Guide",
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
        expect.objectContaining({ path: "AGENTS.md", status: "included" }),
        expect.objectContaining({ path: ".mono/IDENTITY.md", status: "skipped" }),
        expect.objectContaining({ path: ".mono/MEMORY.md", status: "included" }),
        expect.objectContaining({ path: "README.md", status: "included" })
      ])
    );
    expect(result.report.memory.bootstrapMemoryIncluded).toBe(true);
    expect(result.report.memory.retrievedMemoryIds).toEqual(["memory-a"]);
  });

  it("counts AGENTS.md against the bootstrap character budget", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-context-budget-"));
    tempPaths.push(cwd);

    await writeFile(join(cwd, "AGENTS.md"), "1234567890", "utf8");
    await writeFile(join(cwd, "README.md"), "abcdefghij", "utf8");

    const result = await assemblePromptContext({
      cwd,
      sessionId: "session-456",
      sessionStartedAt: Date.UTC(2026, 2, 14, 9, 0, 0),
      profileName: "default",
      model,
      thinkingLevel: "medium",
      verificationMode: "light",
      autoApprove: false,
      config: createResolvedConfigWithBootstrapOverrides({
        totalMaxChars: 10,
        maxCharsPerFile: 10,
      }),
      now: Date.UTC(2026, 2, 14, 10, 30, 0)
    });

    expect(result.report.bootstrapFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "AGENTS.md", status: "included", injectedChars: 10 }),
        expect.objectContaining({ path: "README.md", status: "truncated", injectedChars: 0 }),
      ])
    );
  });

  it("does not inject AGENTS.md when bootstrap files omit it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-context-no-agents-"));
    tempPaths.push(cwd);

    await writeFile(join(cwd, "AGENTS.md"), "Repository agent guide.", "utf8");
    await writeFile(join(cwd, "README.md"), "Workspace readme.", "utf8");

    const result = await assemblePromptContext({
      cwd,
      sessionId: "session-789",
      sessionStartedAt: Date.UTC(2026, 2, 14, 9, 0, 0),
      profileName: "default",
      model,
      thinkingLevel: "medium",
      verificationMode: "light",
      autoApprove: false,
      config: createResolvedConfigWithBootstrapOverrides({
        files: ["README.md"],
      }),
      now: Date.UTC(2026, 2, 14, 10, 30, 0)
    });

    expect(result.systemPrompt).not.toContain("## Agent Guide");
    expect(result.report.bootstrapFiles).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "AGENTS.md" })
      ])
    );
    expect(result.report.bootstrapFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "README.md", status: "included" }),
      ])
    );
  });
});
