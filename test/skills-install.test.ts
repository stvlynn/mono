import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSkillFromSource } from "../packages/cli/src/skills/install.js";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0, tempPaths.length).map((path) => rm(path, { recursive: true, force: true })));
});

async function createSkillRepository(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "mono-skill-repo-"));
  tempPaths.push(repoRoot);

  const perfSkillDir = join(repoRoot, "skills", "react-performance-optimization");
  await mkdir(join(perfSkillDir, "references"), { recursive: true });
  await writeFile(join(perfSkillDir, "SKILL.md"), `---
name: react-performance-optimization
description: Tune React rendering and bundle performance.
---

# React Performance Optimization

Use profiling first.
`, "utf8");
  await writeFile(join(perfSkillDir, "references", "checklist.md"), "- profile first\n", "utf8");

  const reviewSkillDir = join(repoRoot, ".agents", "skills", "repo-review");
  await mkdir(reviewSkillDir, { recursive: true });
  await writeFile(join(reviewSkillDir, "SKILL.md"), `---
name: repo-review
description: Review the repository before editing.
---

# Repo Review

Inspect the repository first.
`, "utf8");

  return repoRoot;
}

describe("skills installer", () => {
  it("installs a selected skill into the mono global skills directory and preserves resources", async () => {
    const repoRoot = await createSkillRepository();
    const configDir = await mkdtemp(join(tmpdir(), "mono-skill-config-"));
    tempPaths.push(configDir);

    const result = await installSkillFromSource("acme/toolbox@react-performance-optimization", {
      destinationRoot: join(configDir, "skills"),
      cloneRepository: async (_source, targetDir) => {
        await cp(repoRoot, targetDir, { recursive: true });
      }
    });

    expect(result.skill.name).toBe("react-performance-optimization");
    expect(result.skill.origin).toBe("global");
    expect(result.installDir).toBe(join(configDir, "skills", "react-performance-optimization"));
    expect(await readFile(join(result.installDir, "SKILL.md"), "utf8")).toContain("React Performance Optimization");
    expect(await readFile(join(result.installDir, "references", "checklist.md"), "utf8")).toContain("profile first");

    const metadata = JSON.parse(await readFile(result.metadataPath, "utf8")) as {
      source: string;
      repoSlug: string;
      requestedSkill?: string;
      sourcePath: string;
    };
    expect(metadata).toMatchObject({
      source: "acme/toolbox@react-performance-optimization",
      repoSlug: "acme/toolbox",
      requestedSkill: "react-performance-optimization",
      sourcePath: "skills/react-performance-optimization"
    });
    expect(result.replacedExisting).toBe(false);
  });

  it("requires @skill-name when a repository exposes multiple skills", async () => {
    const repoRoot = await createSkillRepository();
    const configDir = await mkdtemp(join(tmpdir(), "mono-skill-config-"));
    tempPaths.push(configDir);

    await expect(installSkillFromSource("acme/toolbox", {
      destinationRoot: join(configDir, "skills"),
      cloneRepository: async (_source, targetDir) => {
        await cp(repoRoot, targetDir, { recursive: true });
      }
    })).rejects.toThrow("Multiple skills found in acme/toolbox");
  });
});
