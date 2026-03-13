import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { getMonoConfigPaths } from "@mono/config";

export interface ProjectSkill {
  name: string;
  description: string;
  location: string;
  content: string;
}

const FRONTMATTER_DELIMITER = "---";

function normalizeSkillToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/gu, "-");
}

function parseFrontmatter(raw: string): { metadata: Record<string, string>; body: string } {
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
  const metadata = metadataBlock
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((result, line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        return result;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/gu, "");
      if (key) {
        result[key] = value;
      }
      return result;
    }, {});

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

function parseProjectSkill(filePath: string, raw: string): ProjectSkill {
  const { metadata, body } = parseFrontmatter(raw);
  const fallbackName = basename(dirname(filePath));
  return {
    name: metadata.name?.trim() || fallbackName,
    description: deriveSkillDescription(metadata, body),
    location: filePath,
    content: body
  };
}

function skillMatchesPrompt(skill: ProjectSkill, prompt: string): boolean {
  const promptLower = prompt.toLowerCase();
  const promptNormalized = normalizeSkillToken(prompt);
  const skillName = normalizeSkillToken(skill.name);
  const folderName = normalizeSkillToken(basename(dirname(skill.location)));

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

export async function loadProjectSkills(cwd: string): Promise<ProjectSkill[]> {
  const skillsDir = getMonoConfigPaths(cwd).projectSkillsDir;

  let files: string[];
  try {
    files = await collectSkillFiles(skillsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const loaded = await Promise.all(files.map(async (filePath) => parseProjectSkill(filePath, await readFile(filePath, "utf8"))));
  return loaded.sort((left, right) => left.name.localeCompare(right.name));
}

export function renderProjectSkillsContext(skills: ProjectSkill[], prompt: string, cwd: string): string {
  if (skills.length === 0) {
    return "";
  }

  const activeSkills = skills.filter((skill) => skillMatchesPrompt(skill, prompt));
  const lines = [
    "<ProjectSkills>",
    "Project-local skills are available under .mono/skills.",
    "If an active skill is included below, follow it for this turn.",
    "Available skills:"
  ];

  for (const skill of skills) {
    const pathLabel = relative(cwd, skill.location) || skill.location;
    lines.push(`- ${skill.name}: ${skill.description || "No description"} (${pathLabel})`);
  }

  if (activeSkills.length > 0) {
    lines.push("");
    lines.push("Active skills for this request:");
    for (const skill of activeSkills) {
      lines.push(`<Skill name="${skill.name}" path="${relative(cwd, skill.location) || skill.location}">`);
      lines.push(skill.content.trim());
      lines.push("</Skill>");
    }
  }

  lines.push("</ProjectSkills>");
  return lines.join("\n");
}
