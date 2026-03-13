import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { getMonoConfigPaths } from "@mono/config";
import { loadSkillsFromRoot, normalizeSkillToken, type ProjectSkill } from "@mono/agent-core";
import { parseSkillSource, type ParsedSkillSource } from "./source-parser.js";

const execFileAsync = promisify(execFile);

interface InstalledSkillMetadata {
  version: 1;
  source: string;
  repoSlug: string;
  repoUrl: string;
  ref?: string;
  requestedSkill?: string;
  installedAt: string;
  originalName: string;
  description: string;
  sourcePath: string;
}

export interface InstallSkillResult {
  skill: ProjectSkill;
  installDir: string;
  metadataPath: string;
  replacedExisting: boolean;
}

type CloneRepository = (source: ParsedSkillSource, targetDir: string) => Promise<void>;

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 255) || "unnamed-skill";
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const normalizedBase = resolve(basePath);
  const normalizedTarget = resolve(targetPath);
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${sep}`);
}

async function defaultCloneRepository(source: ParsedSkillSource, targetDir: string): Promise<void> {
  const args = ["clone", "--depth", "1"];
  if (source.ref) {
    args.push("--branch", source.ref);
  }
  args.push(source.repoUrl, targetDir);

  try {
    await execFileAsync("git", args, { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw new Error(`Failed to clone ${source.repoSlug}: ${error.message}`);
    }
    throw new Error(`Failed to clone ${source.repoSlug}`);
  }
}

async function discoverSkills(repoRoot: string, source: ParsedSkillSource): Promise<ProjectSkill[]> {
  const roots = source.subpath
    ? [join(repoRoot, source.subpath)]
    : [
        repoRoot,
        join(repoRoot, "skills"),
        join(repoRoot, ".mono", "skills"),
        join(repoRoot, ".agents", "skills")
      ];

  const discovered = new Map<string, ProjectSkill>();
  for (const root of roots) {
    const skills = await loadSkillsFromRoot(root, "project");
    for (const skill of skills) {
      discovered.set(resolve(skill.location), skill);
    }
  }

  return [...discovered.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function matchesRequestedSkill(skill: ProjectSkill, requestedSkill: string): boolean {
  const normalizedRequested = normalizeSkillToken(requestedSkill);
  const normalizedName = normalizeSkillToken(skill.name);
  const normalizedDir = normalizeSkillToken(basename(dirname(skill.location)));
  return normalizedRequested === normalizedName || normalizedRequested === normalizedDir;
}

function selectSkill(skills: ProjectSkill[], source: ParsedSkillSource): ProjectSkill {
  if (skills.length === 0) {
    throw new Error(`No skills found in ${source.repoSlug}`);
  }

  if (source.skillFilter) {
    const selected = skills.find((skill) => matchesRequestedSkill(skill, source.skillFilter ?? ""));
    if (!selected) {
      const available = skills.map((skill) => skill.name).join(", ");
      throw new Error(`Skill "${source.skillFilter}" was not found in ${source.repoSlug}. Available skills: ${available}`);
    }
    return selected;
  }

  if (skills.length > 1) {
    const available = skills.map((skill) => skill.name).join(", ");
    throw new Error(`Multiple skills found in ${source.repoSlug}. Specify one with @skill-name. Available skills: ${available}`);
  }

  return skills[0]!;
}

export async function installSkillFromSource(
  rawSource: string,
  options?: {
    cwd?: string;
    destinationRoot?: string;
    cloneRepository?: CloneRepository;
    now?: Date;
  }
): Promise<InstallSkillResult> {
  const source = parseSkillSource(rawSource);
  const cwd = options?.cwd ?? process.cwd();
  const destinationRoot = options?.destinationRoot ?? getMonoConfigPaths(cwd).globalSkillsDir;
  const cloneRepository = options?.cloneRepository ?? defaultCloneRepository;
  const tempRoot = await mkdtemp(join(tmpdir(), "mono-skill-install-"));

  try {
    const repoDir = join(tempRoot, "repo");
    await cloneRepository(source, repoDir);

    const discoveredSkills = await discoverSkills(repoDir, source);
    const selectedSkill = selectSkill(discoveredSkills, source);
    const selectedSkillDir = dirname(selectedSkill.location);

    if (!isPathInside(repoDir, selectedSkillDir)) {
      throw new Error(`Resolved skill path escapes the repository root for ${source.repoSlug}`);
    }

    const installName = sanitizeName(selectedSkill.name || basename(selectedSkillDir));
    const installDir = join(destinationRoot, installName);
    if (!isPathInside(destinationRoot, installDir)) {
      throw new Error(`Resolved install path is unsafe for skill ${selectedSkill.name}`);
    }

    await mkdir(destinationRoot, { recursive: true });

    let replacedExisting = true;
    try {
      await stat(installDir);
    } catch {
      replacedExisting = false;
    }
    await rm(installDir, { recursive: true, force: true });

    await cp(selectedSkillDir, installDir, { recursive: true });

    const metadataPath = join(installDir, ".mono-skill.json");
    const metadata: InstalledSkillMetadata = {
      version: 1,
      source: rawSource,
      repoSlug: source.repoSlug,
      repoUrl: source.repoUrl,
      ref: source.ref,
      requestedSkill: source.skillFilter,
      installedAt: (options?.now ?? new Date()).toISOString(),
      originalName: selectedSkill.name,
      description: selectedSkill.description,
      sourcePath: selectedSkillDir.slice(repoDir.length).replace(/^[/\\]+/u, "") || "."
    };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    return {
      skill: {
        ...selectedSkill,
        location: join(installDir, "SKILL.md"),
        origin: "global"
      },
      installDir,
      metadataPath,
      replacedExisting
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
