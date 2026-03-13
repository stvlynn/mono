import { loadProjectSkills, type ProjectSkill } from "@mono/agent-core";

function matchesSkill(skill: ProjectSkill, query: string | undefined): boolean {
  if (!query?.trim()) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  return [skill.name, skill.description, skill.content]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalized));
}

export async function runSkillsList(query?: string): Promise<{ skills: ProjectSkill[] }> {
  const skills = await loadProjectSkills(process.cwd());
  return {
    skills: skills.filter((skill) => matchesSkill(skill, query))
  };
}
