import { createHash } from "node:crypto";
import { getMonoConfigPaths } from "@mono/config";

export function getMonoDir(cwd = process.cwd()): string {
  return getMonoConfigPaths(cwd).globalDir;
}

export function getSessionsDir(cwd = process.cwd()): string {
  return getMonoConfigPaths(cwd).globalSessionsDir;
}

export function cwdSlug(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}
