import { resolve } from "node:path";

export function resolveWithin(baseDir: string, candidate: string): string {
  const resolvedBase = resolve(baseDir);
  const resolvedCandidate = resolve(baseDir, candidate);
  if (resolvedCandidate !== resolvedBase && !resolvedCandidate.startsWith(`${resolvedBase}/`)) {
    throw new Error(`Path escapes workspace: ${candidate}`);
  }

  return resolvedCandidate;
}
