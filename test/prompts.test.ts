import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileTemplateRegistry, NunjucksPromptRenderer, getTemplatesRoot } from "../packages/prompts/src/index.js";
import { renderMemoryContext, renderTraceForCompaction } from "../packages/memory/src/renderer.js";
import { DeterministicMemoryCompactor } from "../packages/memory/src/compactor.js";

describe("prompt renderer", () => {
  it("renders the agent system prompt with cwd and memory context", () => {
    const renderer = new NunjucksPromptRenderer();
    const result = renderer.render("agent/system_prompt", {
      cwd: "/tmp/project",
      memory_context: "<MemoryContext>test</MemoryContext>"
    });

    expect(result).toContain("Current working directory: /tmp/project");
    expect(result).toContain("<MemoryContext>test</MemoryContext>");
  });

  it("tracks template files in the registry", () => {
    const registry = new FileTemplateRegistry();
    expect(registry.exists("agent/system_prompt")).toBe(true);
    expect(existsSync(join(getTemplatesRoot(), "memory/context_block.j2"))).toBe(true);
    expect(existsSync(join(getTemplatesRoot(), "memory/openviking_context_block.j2"))).toBe(true);
    expect(existsSync(join(getTemplatesRoot(), "memory/seekdb_context_block.j2"))).toBe(true);
    expect(registry.exists("ui/waiting_tool_running")).toBe(true);
    expect(registry.list()).toContain("memory/compacted_step_tool_result");
    expect(registry.list()).toContain("memory/openviking_context_block");
    expect(registry.list()).toContain("memory/seekdb_context_block");
    expect(registry.list()).toContain("ui/waiting_assistant_reasoning");
  });

  it("renders UI waiting templates with runtime context", () => {
    const renderer = new NunjucksPromptRenderer();
    const result = renderer.render("ui/waiting_tool_running", {
      emoji: "🐟",
      before: "正在围观",
      tool_name: "bash",
      after: "表演",
      suffix: "……"
    });

    expect(result).toContain("🐟");
    expect(result).toContain("bash");
    expect(result).toContain("表演");
  });
});

describe("templated memory rendering", () => {
  it("renders a templated memory context block", () => {
    const output = renderMemoryContext(
      [
        {
          id: "mem-a",
          createdAt: Date.now(),
          projectKey: "project",
          parents: [],
          children: [],
          referencedMemoryIds: [],
          input: "inspect package.json",
          compacted: ["Read package.json", "Found build script"],
          output: "Summarized package metadata",
          detailed: [],
          tags: [],
          files: ["package.json"],
          tools: ["read"]
        }
      ],
      new Set(["mem-a"])
    );

    expect(output).toContain("<MemoryContext>");
    expect(output).toContain("[mem-a] Read package.json");
    expect(output).toContain("</MemoryContext>");
  });

  it("renders the OpenViking memory context block", () => {
    const renderer = new NunjucksPromptRenderer();
    const output = renderer.render("memory/openviking_context_block", {
      memories: [{ uri: "viking://memory/one", abstract: "Execution memory", score_text: "0.900" }],
      resources: [{ uri: "viking://resource/readme", abstract: "README resource", score_text: "0.450" }],
      skills: [{ uri: "viking://skill/repo-scan", abstract: "Repo scan skill", score_text: "0.220" }]
    });

    expect(output).toContain("<MemoryContext source=\"openviking\">");
    expect(output).toContain("Memories:");
    expect(output).toContain("Resources:");
    expect(output).toContain("Skills:");
    expect(output).toContain("viking://memory/one");
  });

  it("renders the SeekDB memory context block", () => {
    const renderer = new NunjucksPromptRenderer();
    const output = renderer.render("memory/seekdb_context_block", {
      memories: [{ id: "mem-1", summary: "Execution memory summary" }],
      session_entries: [{ id: "entry-1", summary: "Mirrored session summary" }]
    });

    expect(output).toContain("<MemoryContext source=\"seekdb\">");
    expect(output).toContain("SeekDB memory matches:");
    expect(output).toContain("[mem-1] Execution memory summary");
    expect(output).toContain("SeekDB mirrored session entries:");
    expect(output).toContain("[entry-1] Mirrored session summary");
  });

  it("renders compactor trace and compacted steps through templates", async () => {
    const traceText = renderTraceForCompaction([
      { type: "user", text: "run tests" },
      { type: "tool_call", toolName: "bash", args: { cmd: "pnpm test" } }
    ]);
    expect(traceText).toContain("User: run tests");
    expect(traceText).toContain("Tool call bash:");

    const compactor = new DeterministicMemoryCompactor();
    const result = await compactor.compact({
      userRequest: "run tests",
      assistantOutput: "Fixed the failing import.",
      referencedMemoryIds: [],
      trace: [
        { type: "tool_call", toolName: "bash", args: { cmd: "pnpm test" } },
        { type: "tool_result", toolName: "bash", output: "1 failing test" }
      ]
    });

    expect(result.compacted.some((line) => line.startsWith("Received request:"))).toBe(true);
    expect(result.compacted.some((line) => line.startsWith("Tried bash with"))).toBe(true);
    expect(result.compacted.some((line) => line.startsWith("Observed bash result:"))).toBe(true);
    expect(result.compacted.some((line) => line.startsWith("Responded to the user:"))).toBe(true);
  });
});
