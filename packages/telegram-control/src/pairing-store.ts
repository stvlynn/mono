import { randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { MonoConfigStore } from "@mono/config";
import { normalizeTelegramUserId, readJsonFile, writeJsonFile } from "@mono/shared";
import type { TelegramPairingApproval, TelegramPairingRequest } from "./types.js";

const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 60 * 60 * 1000;
const PAIRING_MAX_PENDING = 3;

interface TelegramPendingStoreFile {
  version: 1;
  requests: TelegramPairingRequest[];
}

interface TelegramAllowFromStoreFile {
  version: 1;
  allowFrom: string[];
}

export async function upsertTelegramPairingRequest(
  input: {
    senderId: string;
    username?: string;
    displayName?: string;
  },
  cwd = process.cwd(),
): Promise<{ code: string; created: boolean }> {
  const senderId = normalizeTelegramUserId(input.senderId);
  if (!senderId) {
    throw new Error("Telegram pairing sender id must be a positive numeric Telegram user id");
  }

  const now = Date.now();
  const pending = pruneExpiredRequests(await readPendingRequests(cwd), now);
  const existing = pending.find((request) => request.senderId === senderId);
  if (existing) {
    existing.lastSeenAt = now;
    existing.username = input.username ?? existing.username;
    existing.displayName = input.displayName ?? existing.displayName;
    await writePendingRequests(pending, cwd);
    return { code: existing.code, created: false };
  }

  if (pending.length >= PAIRING_MAX_PENDING) {
    return { code: "", created: false };
  }

  const request: TelegramPairingRequest = {
    senderId,
    code: createPairingCode(new Set(pending.map((entry) => entry.code))),
    createdAt: now,
    lastSeenAt: now,
    username: input.username,
    displayName: input.displayName,
  };
  pending.push(request);
  await writePendingRequests(pending, cwd);
  return { code: request.code, created: true };
}

export async function listTelegramPairingRequests(
  cwd = process.cwd(),
): Promise<TelegramPairingRequest[]> {
  const requests = pruneExpiredRequests(await readPendingRequests(cwd), Date.now());
  await writePendingRequests(requests, cwd);
  return requests;
}

export async function approveTelegramPairingCode(
  code: string,
  cwd = process.cwd(),
): Promise<TelegramPairingApproval | null> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  const requests = pruneExpiredRequests(await readPendingRequests(cwd), Date.now());
  const match = requests.find((request) => request.code === normalizedCode);
  if (!match) {
    return null;
  }

  const remaining = requests.filter((request) => request.code !== normalizedCode);
  await writePendingRequests(remaining, cwd);
  const added = await addTelegramAllowFromStoreEntry(match.senderId, cwd);
  return {
    senderId: match.senderId,
    code: normalizedCode,
    source: "code",
    added,
  };
}

export async function allowTelegramUserId(
  userId: string,
  cwd = process.cwd(),
): Promise<TelegramPairingApproval> {
  const normalized = normalizeTelegramUserId(userId);
  if (!normalized) {
    throw new Error("Telegram user id must be a positive numeric Telegram user id");
  }
  const added = await addTelegramAllowFromStoreEntry(normalized, cwd);
  return {
    senderId: normalized,
    source: "userid",
    added,
  };
}

export async function readTelegramAllowFromStore(cwd = process.cwd()): Promise<string[]> {
  const file = await readAllowFromStoreFile(cwd);
  return file.allowFrom;
}

async function addTelegramAllowFromStoreEntry(entry: string, cwd: string): Promise<boolean> {
  const normalized = normalizeTelegramUserId(entry);
  if (!normalized) {
    throw new Error("Telegram allowlist entry must be a positive numeric Telegram user id");
  }

  const file = await readAllowFromStoreFile(cwd);
  if (file.allowFrom.includes(normalized)) {
    return false;
  }
  file.allowFrom.push(normalized);
  await writeAllowFromStoreFile(file, cwd);
  return true;
}

async function readPendingRequests(cwd: string): Promise<TelegramPairingRequest[]> {
  const file = await readJsonFile<TelegramPendingStoreFile>(resolvePendingStorePath(cwd));
  return file?.requests ?? [];
}

async function writePendingRequests(requests: TelegramPairingRequest[], cwd: string): Promise<void> {
  await ensureTelegramStateDir(cwd);
  await writeJsonFile(resolvePendingStorePath(cwd), {
    version: 1,
    requests,
  } satisfies TelegramPendingStoreFile);
}

async function readAllowFromStoreFile(cwd: string): Promise<TelegramAllowFromStoreFile> {
  const file = await readJsonFile<TelegramAllowFromStoreFile>(resolveAllowFromStorePath(cwd));
  return {
    version: 1,
    allowFrom: file?.allowFrom?.map(String).filter(Boolean) ?? [],
  };
}

async function writeAllowFromStoreFile(file: TelegramAllowFromStoreFile, cwd: string): Promise<void> {
  await ensureTelegramStateDir(cwd);
  await writeJsonFile(resolveAllowFromStorePath(cwd), file);
}

function pruneExpiredRequests(
  requests: TelegramPairingRequest[],
  now: number,
): TelegramPairingRequest[] {
  return requests.filter((request) => now - request.createdAt <= PAIRING_TTL_MS);
}

function createPairingCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    let code = "";
    for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
      code += PAIRING_CODE_ALPHABET[randomInt(0, PAIRING_CODE_ALPHABET.length)];
    }
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error("Failed to allocate a unique Telegram pairing code");
}

async function ensureTelegramStateDir(cwd: string): Promise<void> {
  await mkdir(resolveTelegramStateDir(cwd), { recursive: true });
}

function resolveTelegramStateDir(cwd: string): string {
  const store = new MonoConfigStore(cwd);
  return join(store.paths.globalStateDir, "telegram");
}

function resolvePendingStorePath(cwd: string): string {
  return join(resolveTelegramStateDir(cwd), "pairing.json");
}

function resolveAllowFromStorePath(cwd: string): string {
  return join(resolveTelegramStateDir(cwd), "allowFrom.json");
}
