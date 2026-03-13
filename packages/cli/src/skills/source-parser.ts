export interface ParsedSkillSource {
  raw: string;
  repoSlug: string;
  repoUrl: string;
  ref?: string;
  subpath?: string;
  skillFilter?: string;
}

function sanitizeSubpath(subpath: string): string {
  const normalized = subpath.replace(/\\/gu, "/").trim().replace(/^\/+|\/+$/gu, "");
  if (!normalized) {
    throw new Error("Skill source subpath cannot be empty");
  }

  for (const segment of normalized.split("/")) {
    if (segment === "..") {
      throw new Error(`Unsafe skill source subpath: "${subpath}"`);
    }
  }

  return normalized;
}

function splitSkillFilter(source: string): { base: string; skillFilter?: string } {
  const trimmed = source.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0) {
    return { base: trimmed };
  }

  const suffix = trimmed.slice(atIndex + 1).trim();
  if (!suffix || suffix.includes("/") || suffix.includes(":")) {
    return { base: trimmed };
  }

  return {
    base: trimmed.slice(0, atIndex),
    skillFilter: suffix
  };
}

export function parseSkillSource(source: string): ParsedSkillSource {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("Skill source is required");
  }

  const { base, skillFilter } = splitSkillFilter(trimmed);

  const shorthandMatch = base.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/u);
  if (shorthandMatch) {
    const owner = shorthandMatch[1] ?? "";
    const repo = shorthandMatch[2] ?? "";
    return {
      raw: trimmed,
      repoSlug: `${owner}/${repo}`,
      repoUrl: `https://github.com/${owner}/${repo}.git`,
      skillFilter
    };
  }

  const repoUrlMatch = base.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/u);
  if (repoUrlMatch) {
    const owner = repoUrlMatch[1] ?? "";
    const repo = repoUrlMatch[2] ?? "";
    return {
      raw: trimmed,
      repoSlug: `${owner}/${repo}`,
      repoUrl: `https://github.com/${owner}/${repo}.git`,
      skillFilter
    };
  }

  const treeUrlMatch = base.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/tree\/([^/]+)(?:\/(.+))?$/u);
  if (treeUrlMatch) {
    const owner = treeUrlMatch[1] ?? "";
    const repo = treeUrlMatch[2] ?? "";
    const ref = treeUrlMatch[3] ?? "";
    const subpath = treeUrlMatch[4] ? sanitizeSubpath(treeUrlMatch[4]) : undefined;
    return {
      raw: trimmed,
      repoSlug: `${owner}/${repo}`,
      repoUrl: `https://github.com/${owner}/${repo}.git`,
      ref,
      subpath,
      skillFilter
    };
  }

  throw new Error(`Unsupported skill source: "${source}"`);
}
