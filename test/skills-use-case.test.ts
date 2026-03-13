import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSkillsFind, runSkillsList } from "../packages/cli/src/use-cases/skills.js";

const tempPaths: string[] = [];
const originalMonoConfigDir = process.env.MONO_CONFIG_DIR;
const originalFetch = global.fetch;

afterEach(async () => {
  if (originalMonoConfigDir === undefined) {
    delete process.env.MONO_CONFIG_DIR;
  } else {
    process.env.MONO_CONFIG_DIR = originalMonoConfigDir;
  }

  global.fetch = originalFetch;
  vi.restoreAllMocks();
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
  it("lists available skills and supports filtering", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-skills-cli-"));
    const configDir = await mkdtemp(join(tmpdir(), "mono-skills-cli-config-"));
    tempPaths.push(cwd, configDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeSkill(cwd, "repo-review", "Review the repository", "# Repo Review\n\nInspect the repo.");
    await writeSkill(cwd, "test-writer", "Write tests first", "# Test Writer\n\nWrite failing tests first.");

    const all = await runSkillsList(undefined, cwd);
    const filtered = await runSkillsList("tests first", cwd);

    expect(all.skills.map((skill) => skill.name)).toEqual(["find-skills", "repo-review", "skill-creator", "test-writer"]);
    expect(filtered.skills.map((skill) => skill.name)).toEqual(["test-writer"]);
  });

  it("queries the remote skills registry and returns install sources", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [
          {
            id: "nickcrew/claude-ctx-plugin/react-performance-optimization",
            skillId: "react-performance-optimization",
            name: "react-performance-optimization",
            installs: 612,
            source: "nickcrew/claude-ctx-plugin"
          }
        ]
      })
    } as Response);

    const result = await runSkillsFind("react performance");

    expect(result.query).toBe("react performance");
    expect(result.results).toEqual([
      {
        id: "nickcrew/claude-ctx-plugin/react-performance-optimization",
        name: "react-performance-optimization",
        source: "nickcrew/claude-ctx-plugin",
        installs: 612,
        installSource: "nickcrew/claude-ctx-plugin@react-performance-optimization",
        url: "https://skills.sh/nickcrew/claude-ctx-plugin/react-performance-optimization"
      }
    ]);
  });
});
