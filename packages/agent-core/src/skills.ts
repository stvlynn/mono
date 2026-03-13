import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { getMonoConfigPaths } from "@mono/config";
import { getBuiltinSkills } from "./builtin-skills.js";

export type SkillOrigin = "builtin" | "global" | "project";

export interface ProjectSkill {
  name: string;
  description: string;
  location: string;
  content: string;
  origin: SkillOrigin;
}

interface ParsedFrontmatter {
  metadata: Record<string, string>;
  body: string;
}

const FRONTMATTER_DELIMITER = "---";

export function normalizeSkillToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/gu, "-");
}

function stripWrappingQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/gu, "");
}

function parseBlockScalar(lines: string[], startIndex: number): { value: string; nextIndex: number } {
  const blockLines: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (trimmed && indent === 0) {
      break;
    }

    blockLines.push(line);
    index += 1;
  }

  const nonEmpty = blockLines.filter((line) => line.trim().length > 0);
  const minIndent = nonEmpty.length > 0
    ? Math.min(...nonEmpty.map((line) => line.length - line.trimStart().length))
    : 0;

  const value = blockLines
    .map((line) => line.slice(minIndent))
    .join("\n")
    .trim();

  return { value, nextIndex: index };
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/\r\n/gu, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return {
      metadata: {},
      body: normalized.trim()
    };
  }

  const closingIndex = normalized.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, FRONTMATTER_DELIMITER.length + 1);
  if (closingIndex === -1) {
    return {
      metadata: {},
      body: normalized.trim()
    };
  }

  const metadataBlock = normalized.slice(FRONTMATTER_DELIMITER.length + 1, closingIndex);
  const body = normalized.slice(closingIndex + `\n${FRONTMATTER_DELIMITER}\n`.length).trim();
  const metadata: Record<string, string> = {};
  const lines = metadataBlock.split("\n");

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trimEnd();
    const trimmed = line.trimStart();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (rawLine.length !== trimmed.length) {
      index += 1;
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      index += 1;
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      index += 1;
      continue;
    }

    if (rawValue === "|" || rawValue === ">") {
      const block = parseBlockScalar(lines, index + 1);
      metadata[key] = block.value;
      index = block.nextIndex;
      continue;
    }

    metadata[key] = stripWrappingQuotes(rawValue);
    index += 1;
  }

  return { metadata, body };
}

function deriveSkillDescription(metadata: Record<string, string>, body: string): string {
  if (metadata.description) {
    return metadata.description;
  }

  const firstMeaningfulLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  return firstMeaningfulLine ?? "";
}

async function collectSkillFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const location = join(root, entry.name);
    if (entry.isDirectory()) {
      return collectSkillFiles(location);
    }
    return entry.isFile() && entry.name === "SKILL.md" ? [location] : [];
  }));

  return nested.flat().sort((left, right) => left.localeCompare(right));
}

export function parseProjectSkill(filePath: string, raw: string, origin: SkillOrigin): ProjectSkill {
  const { metadata, body } = parseFrontmatter(raw);
  const fallbackName = basename(dirname(filePath));
  return {
    name: metadata.name?.trim() || fallbackName,
    description: deriveSkillDescription(metadata, body),
    location: filePath,
    content: body,
    origin
  };
}

export async function loadSkillsFromRoot(root: string, origin: SkillOrigin): Promise<ProjectSkill[]> {
  let files: string[];
  try {
    files = await collectSkillFiles(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const loaded = await Promise.all(files.map(async (filePath) => parseProjectSkill(filePath, await readFile(filePath, "utf8"), origin)));
  return loaded.sort((left, right) => left.name.localeCompare(right.name));
}

function mergeVisibleSkills(skillGroups: ProjectSkill[][]): ProjectSkill[] {
  const merged = new Map<string, ProjectSkill>();

  for (const group of skillGroups) {
    for (const skill of group) {
      merged.set(normalizeSkillToken(skill.name), skill);
    }
  }

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function resolveSkillReferenceLabel(skill: ProjectSkill, cwd: string): string {
  if (skill.origin === "builtin") {
    return skill.location;
  }
  return relative(cwd, skill.location) || skill.location;
}

function resolveSkillFolderToken(skill: ProjectSkill): string {
  if (skill.location.endsWith("SKILL.md")) {
    return basename(dirname(skill.location));
  }
  return basename(skill.location);
}

function skillMatchesPrompt(skill: ProjectSkill, prompt: string): boolean {
  const promptLower = prompt.toLowerCase();
  const promptNormalized = normalizeSkillToken(prompt);
  const skillName = normalizeSkillToken(skill.name);
  const folderName = normalizeSkillToken(resolveSkillFolderToken(skill));

  const exactMentions = [
    `$${skill.name.toLowerCase()}`,
    skill.name.toLowerCase()
  ];
  if (exactMentions.some((token) => token && promptLower.includes(token))) {
    return true;
  }

  return [skillName, folderName]
    .filter((token) => token.length >= 3)
    .some((token) => promptNormalized.includes(token));
}

export async function loadBuiltinSkills(): Promise<ProjectSkill[]> {
  return getBuiltinSkills();
}

export async function loadGlobalSkills(cwd: string): Promise<ProjectSkill[]> {
  const skillsDir = getMonoConfigPaths(cwd).globalSkillsDir;
  return loadSkillsFromRoot(skillsDir, "global");
}

export async function loadProjectSkills(cwd: string): Promise<ProjectSkill[]> {
  const skillsDir = getMonoConfigPaths(cwd).projectSkillsDir;
  return loadSkillsFromRoot(skillsDir, "project");
}

export async function loadAvailableSkills(cwd: string): Promise<ProjectSkill[]> {
  const [builtinSkills, globalSkills, projectSkills] = await Promise.all([
    loadBuiltinSkills(),
    loadGlobalSkills(cwd),
    loadProjectSkills(cwd)
  ]);

  return mergeVisibleSkills([builtinSkills, globalSkills, projectSkills]);
}

export function renderSkillsContext(skills: ProjectSkill[], prompt: string, cwd: string): string {
  if (skills.length === 0) {
    return "";
  }

  const activeSkills = skills.filter((skill) => skillMatchesPrompt(skill, prompt));
  const lines = [
    "<ProjectSkills>",
    "Skills are available from builtin, global (~/.mono/skills), and project (.mono/skills) scopes.",
    "If an active skill is included below, follow it for this turn.",
    "Available skills:"
  ];

  for (const skill of skills) {
    const pathLabel = resolveSkillReferenceLabel(skill, cwd);
    lines.push(`- ${skill.name} [${skill.origin}]: ${skill.description || "No description"} (${pathLabel})`);
  }

  if (activeSkills.length > 0) {
    lines.push("");
    lines.push("Active skills for this request:");
    for (const skill of activeSkills) {
      lines.push(`<Skill name="${skill.name}" origin="${skill.origin}" path="${resolveSkillReferenceLabel(skill, cwd)}">`);
      lines.push(skill.content.trim());
      lines.push("</Skill>");
    }
  }

  lines.push("</ProjectSkills>");
  return lines.join("\n");
}

export function renderProjectSkillsContext(skills: ProjectSkill[], prompt: string, cwd: string): string {
  return renderSkillsContext(skills, prompt, cwd);
}
