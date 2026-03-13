import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectSkills, renderProjectSkillsContext } from "../packages/agent-core/src/skills.js";
import { createDefaultSystemPrompt } from "../packages/agent-core/src/system-prompt.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeSkill(root: string, folder: string, body: string): Promise<void> {
  const dir = join(root, ".mono", "skills", folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), body, "utf8");
}

describe("project skills", () => {
  it("loads project skills from .mono/skills recursively", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-skills-"));
    tempPaths.push(cwd);
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
      description: "Review the repository before coding."
    });
    expect(skills[0]?.location).toContain(".mono");
    expect(skills[0]?.content).toContain("# Repo Review");
  });

  it("renders available skills and injects active skill content when explicitly mentioned", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-skills-context-"));
    tempPaths.push(cwd);
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

    const skills = await loadProjectSkills(cwd);
    const context = renderProjectSkillsContext(skills, "Use $repo-review before changing code", cwd);

    expect(context).toContain("<ProjectSkills>");
    expect(context).toContain("Available skills:");
    expect(context).toContain("- repo-review: Review the repository before coding.");
    expect(context).toContain("- test-writer: Focus on tests first.");
    expect(context).toContain("<Skill name=\"repo-review\"");
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
