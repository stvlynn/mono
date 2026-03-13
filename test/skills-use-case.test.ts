import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSkillsList } from "../packages/cli/src/use-cases/skills.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeSkill(root: string, name: string, description: string, body: string): Promise<void> {
  const dir = join(root, ".mono", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---
name: ${name}
description: ${description}
---

${body}
`, "utf8");
}

describe("skills use case", () => {
  it("lists project-local skills and supports filtering", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-skills-cli-"));
    tempPaths.push(cwd);
    await writeSkill(cwd, "repo-review", "Review the repository", "# Repo Review\n\nInspect the repo.");
    await writeSkill(cwd, "test-writer", "Write tests first", "# Test Writer\n\nWrite failing tests first.");

    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      const all = await runSkillsList();
      const filtered = await runSkillsList("tests first");

      expect(all.skills.map((skill) => skill.name)).toEqual(["repo-review", "test-writer"]);
      expect(filtered.skills.map((skill) => skill.name)).toEqual(["test-writer"]);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
