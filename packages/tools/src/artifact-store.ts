import { copyFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createId, ensureParentDir, type ArtifactHandle } from "@mono/shared";

const ARTIFACTS_DIR = ".mono/artifacts";

interface ArtifactTarget {
  relativePath: string;
  absolutePath: string;
}

export async function persistArtifactText(
  cwd: string,
  toolName: string,
  content: string,
  mimeType = "text/plain"
): Promise<ArtifactHandle> {
  const target = createArtifactTarget(cwd, toolName, extensionForMimeType(mimeType));
  await ensureParentDir(target.absolutePath);
  await writeFile(target.absolutePath, content, "utf8");
  return createArtifactHandle(target.relativePath, mimeType, Buffer.byteLength(content, "utf8"));
}

export async function persistArtifactFile(
  cwd: string,
  toolName: string,
  sourceFilePath: string,
  mimeType = "text/plain"
): Promise<ArtifactHandle> {
  const target = createArtifactTarget(cwd, toolName, extensionForMimeType(mimeType));
  await ensureParentDir(target.absolutePath);
  await copyFile(sourceFilePath, target.absolutePath);
  const details = await stat(target.absolutePath);
  return createArtifactHandle(target.relativePath, mimeType, details.size);
}

function createArtifactTarget(cwd: string, toolName: string, extension: string): ArtifactTarget {
  const id = createId();
  const safeToolName = sanitizeToolName(toolName);
  const fileName = `${safeToolName}-${id}${extension}`;
  const relativePath = `${ARTIFACTS_DIR}/${fileName}`;
  return {
    relativePath,
    absolutePath: join(cwd, relativePath),
  };
}

function createArtifactHandle(path: string, mimeType: string, sizeBytes: number): ArtifactHandle {
  return {
    id: createId(),
    path,
    mimeType,
    sizeBytes,
  };
}

function sanitizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "artifact";
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "application/json") {
    return ".json";
  }
  return ".txt";
}
