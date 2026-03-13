const DEFAULT_SKILLS_API_URL = process.env.MONO_SKILLS_API_URL || "https://skills.sh";

interface SearchApiResponse {
  skills?: Array<{
    id?: string;
    skillId?: string;
    name?: string;
    installs?: number;
    source?: string;
  }>;
}

export interface RemoteSkillSearchResult {
  id: string;
  name: string;
  source: string;
  installs: number;
  installSource: string;
  url: string;
}

export async function searchRemoteSkills(
  query: string,
  options?: {
    apiBaseUrl?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<RemoteSkillSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const apiBaseUrl = options?.apiBaseUrl ?? DEFAULT_SKILLS_API_URL;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const url = new URL("/api/search", apiBaseUrl);
  url.searchParams.set("q", normalizedQuery);
  url.searchParams.set("limit", "10");

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`Skill search failed with status ${response.status}`);
  }

  const payload = await response.json() as SearchApiResponse;
  return (payload.skills ?? [])
    .filter((skill): skill is Required<NonNullable<SearchApiResponse["skills"]>[number]> => Boolean(skill.id && skill.name && skill.source && skill.skillId))
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      source: skill.source,
      installs: skill.installs ?? 0,
      installSource: `${skill.source}@${skill.skillId}`,
      url: `${apiBaseUrl.replace(/\/$/u, "")}/${skill.id}`
    }));
}
