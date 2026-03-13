import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAvailableSkills, loadProjectSkills, renderSkillsContext } from "../packages/agent-core/src/skills.js";
import { createDefaultSystemPrompt } from "../packages/agent-core/src/system-prompt.js";

const tempPaths: string[] = [];
const originalMonoConfigDir = process.env.MONO_CONFIG_DIR;

afterEach(async () => {
  if (originalMonoConfigDir === undefined) {
    delete process.env.MONO_CONFIG_DIR;
  } else {
    process.env.MONO_CONFIG_DIR = originalMonoConfigDir;
  }

  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeSkill(root: string, folder: string, body: string, scope: "project" | "global" = "project"): Promise<void> {
  const baseDir = scope === "project" ? join(root, ".mono", "skills") : join(root, "skills");
  const dir = join(baseDir, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), body, "utf8");
}

describe("project skills", () => {
  it("loads project skills from .mono/skills recursively", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-skills-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-skills-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeSkill(cwd, "repo-review", `---
name: repo-review
description: Review the repository before coding.
---

# Repo Review

Read the repo before editing.`);

    const skills = await loadProjectSkills(cwd);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: "repo-review",
      description: "Review the repository before coding.",
      origin: "project"
    });
    expect(skills[0]?.location).toContain(".mono");
    expect(skills[0]?.content).toContain("# Repo Review");
  });

  it("parses multi-line frontmatter descriptions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-skills-multiline-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-skills-multiline-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeSkill(cwd, "mind-manager", `---
name: mind-manager
description: |
  Manage ideas and drafts.
  Trigger on notes, drafts, and writing workflow requests.
---

# Mind Manager

Organize ideas.`);

    const [skill] = await loadProjectSkills(cwd);

    expect(skill?.description).toBe([
      "Manage ideas and drafts.",
      "Trigger on notes, drafts, and writing workflow requests."
    ].join("\n"));
  });

  it("merges builtin, global, and project skills while preferring project over global and builtin", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-skills-available-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-skills-global-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeSkill(configDir, "find-skills", `---
name: find-skills
description: Global override.
---

# Global Find Skills

Use the global version.`, "global");
    await writeSkill(cwd, "find-skills", `---
name: find-skills
description: Project override.
---

# Project Find Skills

Use the project version.`);
    await writeSkill(configDir, "repo-review", `---
name: repo-review
description: Review the repository before coding.
---

# Repo Review

Inspect the repository first.`, "global");

    const skills = await loadAvailableSkills(cwd);

    expect(skills.map((skill) => skill.name)).toEqual(["find-skills", "repo-review", "skill-creator"]);
    expect(skills.find((skill) => skill.name === "find-skills")).toMatchObject({
      description: "Project override.",
      origin: "project"
    });
    expect(skills.find((skill) => skill.name === "repo-review")).toMatchObject({
      origin: "global"
    });
    expect(skills.find((skill) => skill.name === "skill-creator")).toMatchObject({
      origin: "builtin"
    });
  });

  it("renders available skills and injects active skill content when explicitly mentioned", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-skills-context-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-skills-context-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeSkill(cwd, "repo-review", `---
name: repo-review
description: Review the repository before coding.
---

# Repo Review

Read the repo before editing.`);
    await writeSkill(cwd, "test-writer", `---
name: test-writer
description: Focus on tests first.
---

# Test Writer

Write the failing test before the fix.`);

    const skills = await loadAvailableSkills(cwd);
    const context = renderSkillsContext(skills, "Use $repo-review before changing code", cwd);

    expect(context).toContain("<ProjectSkills>");
    expect(context).toContain("Available skills:");
    expect(context).toContain("- find-skills [builtin]:");
    expect(context).toContain("- repo-review [project]: Review the repository before coding.");
    expect(context).toContain("- test-writer [project]: Focus on tests first.");
    expect(context).toContain("<Skill name=\"repo-review\" origin=\"project\"");
    expect(context).toContain("Read the repo before editing.");
    expect(context).not.toContain("<Skill name=\"test-writer\"");
  });

  it("threads skills context into the default system prompt", () => {
    const prompt = createDefaultSystemPrompt(
      "/tmp/project",
      "<MemoryContext>memory</MemoryContext>",
      "Task phase: execute",
      "<ProjectSkills>skills</ProjectSkills>"
    );

    expect(prompt).toContain("<MemoryContext>memory</MemoryContext>");
    expect(prompt).toContain("<ProjectSkills>skills</ProjectSkills>");
  });
});
