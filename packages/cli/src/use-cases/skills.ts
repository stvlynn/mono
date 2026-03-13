import { loadAvailableSkills, type ProjectSkill } from "@mono/agent-core";
import { installSkillFromSource } from "../skills/install.js";
import { searchRemoteSkills, type RemoteSkillSearchResult } from "../skills/search.js";

function matchesSkill(skill: ProjectSkill, query: string | undefined): boolean {
  if (!query?.trim()) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  return [skill.name, skill.description, skill.content, skill.origin]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalized));
}

export async function runSkillsList(query?: string, cwd = process.cwd()): Promise<{ skills: ProjectSkill[] }> {
  const skills = await loadAvailableSkills(cwd);
  return {
    skills: skills.filter((skill) => matchesSkill(skill, query))
  };
}

export async function runSkillsFind(
  query: string,
  options?: {
    fetchImpl?: typeof fetch;
  }
): Promise<{ query: string; results: RemoteSkillSearchResult[] }> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error("Provide a search query, for example: mono skills find react performance");
  }

  return {
    query: normalizedQuery,
    results: await searchRemoteSkills(normalizedQuery, {
      fetchImpl: options?.fetchImpl
    })
  };
}

export async function runSkillsAdd(
  source: string,
  options?: {
    cwd?: string;
  }
): Promise<{
  source: string;
  skill: ProjectSkill;
  installDir: string;
  metadataPath: string;
  replacedExisting: boolean;
}> {
  const result = await installSkillFromSource(source, {
    cwd: options?.cwd
  });

  return {
    source,
    skill: result.skill,
    installDir: result.installDir,
    metadataPath: result.metadataPath,
    replacedExisting: result.replacedExisting
  };
}
