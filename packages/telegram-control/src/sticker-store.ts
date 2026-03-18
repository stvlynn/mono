import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MonoConfigStore } from "@mono/config";
import {
  readJsonFile,
  resolveWithin,
  writeJsonFile,
  type ChannelStoreResult,
} from "@mono/shared";
import type { MonoTelegramConfig } from "@mono/shared";

export interface TelegramStickerStoreEntry {
  emoji: string;
  fileId: string;
}

export interface TelegramStickerStorePack {
  id: string;
  telegramSetName?: string;
  stickers?: TelegramStickerStoreEntry[];
}

export interface TelegramStickerStoreFile {
  version: 1;
  packs: TelegramStickerStorePack[];
}

export interface TelegramStickerCacheEntry {
  fileId: string;
  fileUniqueId?: string;
  emoji?: string;
  setName?: string;
  description?: string;
  cachedAt: string;
}

export interface TelegramStickerCacheFile {
  version: 1;
  stickers: Record<string, TelegramStickerCacheEntry>;
}

export async function readTelegramStickerStore(
  cwd: string,
  config: MonoTelegramConfig,
): Promise<TelegramStickerStoreFile> {
  const file = await readJsonFile<TelegramStickerStoreFile>(resolveTelegramStickerStorePath(cwd, config));

  return {
    version: 1,
    packs: normalizeStickerStorePacks(file?.packs),
  };
}

export function resolveTelegramStickerStorePath(
  cwd: string,
  config: MonoTelegramConfig,
): string {
  return resolveWithin(cwd, config.reply.stickers.storePath);
}

export async function upsertTelegramStickerStore(
  cwd: string,
  config: MonoTelegramConfig,
  entry: {
    packId?: string;
    emoji?: string;
    fileId?: string;
    telegramSetName?: string;
  },
): Promise<TelegramStickerStoreFile> {
  const filePath = resolveTelegramStickerStorePath(cwd, config);
  const store = await readTelegramStickerStore(cwd, config);
  const next = applyTelegramStickerStoreUpsert(store, entry);
  await writeJsonFile(filePath, next);
  return next;
}

export async function readTelegramStickerCache(cwd: string): Promise<TelegramStickerCacheFile> {
  const file = await readJsonFile<TelegramStickerCacheFile>(resolveTelegramStickerCachePath(cwd));
  return {
    version: 1,
    stickers: normalizeStickerCacheEntries(file?.stickers),
  };
}

export function resolveTelegramStickerCachePath(cwd: string): string {
  const store = new MonoConfigStore(cwd);
  return join(store.paths.globalStateDir, "telegram", "sticker-cache.json");
}

export async function cacheTelegramSticker(
  cwd: string,
  sticker: {
    fileId: string;
    fileUniqueId?: string;
    emoji?: string;
    setName?: string;
    description?: string;
  },
): Promise<TelegramStickerCacheFile> {
  const filePath = resolveTelegramStickerCachePath(cwd);
  await mkdir(dirname(filePath), { recursive: true });
  const cache = await readTelegramStickerCache(cwd);
  const cacheKey = sticker.fileUniqueId?.trim() || sticker.fileId.trim();
  cache.stickers[cacheKey] = {
    fileId: sticker.fileId.trim(),
    ...(sticker.fileUniqueId?.trim() ? { fileUniqueId: sticker.fileUniqueId.trim() } : {}),
    ...(sticker.emoji?.trim() ? { emoji: sticker.emoji.trim() } : {}),
    ...(sticker.setName?.trim() ? { setName: sticker.setName.trim() } : {}),
    ...(sticker.description?.trim() ? { description: sticker.description.trim() } : {}),
    cachedAt: new Date().toISOString(),
  };
  const next = {
    version: 1 as const,
    stickers: normalizeStickerCacheEntries(cache.stickers),
  };
  await writeJsonFile(filePath, next);
  return next;
}

export async function cacheTelegramStickerSet(
  cwd: string,
  input: {
    setName?: string;
    stickers: Array<{
      fileId?: string;
      fileUniqueId?: string;
      emoji?: string;
      description?: string;
    }>;
  },
): Promise<TelegramStickerCacheFile> {
  let cache = await readTelegramStickerCache(cwd);
  for (const sticker of input.stickers) {
    const fileId = sticker.fileId?.trim();
    if (!fileId) {
      continue;
    }
    const cacheKey = sticker.fileUniqueId?.trim() || fileId;
    cache.stickers[cacheKey] = {
      fileId,
      ...(sticker.fileUniqueId?.trim() ? { fileUniqueId: sticker.fileUniqueId.trim() } : {}),
      ...(sticker.emoji?.trim() ? { emoji: sticker.emoji.trim() } : {}),
      ...(input.setName?.trim() ? { setName: input.setName.trim() } : {}),
      ...(sticker.description?.trim() ? { description: sticker.description.trim() } : {}),
      cachedAt: new Date().toISOString(),
    };
  }
  const filePath = resolveTelegramStickerCachePath(cwd);
  await mkdir(dirname(filePath), { recursive: true });
  const next = {
    version: 1 as const,
    stickers: normalizeStickerCacheEntries(cache.stickers),
  };
  await writeJsonFile(filePath, next);
  return next;
}

export async function searchTelegramStickerCache(
  cwd: string,
  input: {
    query?: string;
    setName?: string;
    limit?: number;
    excludeFileId?: string;
  },
): Promise<TelegramStickerCacheEntry[]> {
  const cache = await readTelegramStickerCache(cwd);
  const query = input.query?.trim().toLowerCase() ?? "";
  const setName = input.setName?.trim().toLowerCase() ?? "";
  const excludeFileId = input.excludeFileId?.trim();
  const limit = Math.max(1, Math.min(20, input.limit ?? 5));

  const results = Object.values(cache.stickers)
    .filter((sticker) => !excludeFileId || sticker.fileId !== excludeFileId)
    .map((sticker) => ({
      sticker,
      score: scoreTelegramStickerCacheEntry(sticker, { query, setName }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.sticker.fileId.localeCompare(right.sticker.fileId))
    .slice(0, limit)
    .map((entry) => entry.sticker);

  return results;
}

export function summarizeTelegramStickerStore(
  path: string,
  store: TelegramStickerStoreFile,
): Pick<ChannelStoreResult, "path" | "entryCount"> {
  return {
    path,
    entryCount: store.packs.reduce((total, pack) => total + (pack.stickers?.length ?? 0), 0),
  };
}

function normalizeStickerStorePacks(
  packs: TelegramStickerStorePack[] | undefined,
): TelegramStickerStorePack[] {
  const normalized: TelegramStickerStorePack[] = [];
  const seenPackIds = new Set<string>();

  for (const pack of packs ?? []) {
    const id = pack.id?.trim();
    if (!id || seenPackIds.has(id)) {
      continue;
    }

    const telegramSetName = pack.telegramSetName?.trim();
    const stickers = normalizeStickerEntries(pack.stickers);
    if (!telegramSetName && stickers.length === 0) {
      continue;
    }

    seenPackIds.add(id);
    normalized.push({
      id,
      ...(telegramSetName ? { telegramSetName } : {}),
      ...(stickers.length > 0 ? { stickers } : {}),
    });
  }

  return normalized;
}

function normalizeStickerEntries(
  stickers: TelegramStickerStoreEntry[] | undefined,
): TelegramStickerStoreEntry[] {
  const normalized: TelegramStickerStoreEntry[] = [];
  const seenEntries = new Set<string>();

  for (const sticker of stickers ?? []) {
    const emoji = sticker.emoji?.trim();
    const fileId = sticker.fileId?.trim();
    if (!emoji || !fileId) {
      continue;
    }

    const key = `${emoji}:${fileId}`;
    if (seenEntries.has(key)) {
      continue;
    }

    seenEntries.add(key);
    normalized.push({ emoji, fileId });
  }

  return normalized;
}

function normalizeStickerCacheEntries(
  stickers: Record<string, TelegramStickerCacheEntry> | undefined,
): Record<string, TelegramStickerCacheEntry> {
  const normalized: Record<string, TelegramStickerCacheEntry> = {};

  for (const [key, sticker] of Object.entries(stickers ?? {})) {
    const fileId = sticker.fileId?.trim();
    if (!fileId) {
      continue;
    }
    const cacheKey = key.trim() || sticker.fileUniqueId?.trim() || fileId;
    normalized[cacheKey] = {
      fileId,
      ...(sticker.fileUniqueId?.trim() ? { fileUniqueId: sticker.fileUniqueId.trim() } : {}),
      ...(sticker.emoji?.trim() ? { emoji: sticker.emoji.trim() } : {}),
      ...(sticker.setName?.trim() ? { setName: sticker.setName.trim() } : {}),
      ...(sticker.description?.trim() ? { description: sticker.description.trim() } : {}),
      cachedAt: sticker.cachedAt?.trim() || new Date().toISOString(),
    };
  }

  return normalized;
}

function scoreTelegramStickerCacheEntry(
  sticker: TelegramStickerCacheEntry,
  input: { query: string; setName: string },
): number {
  let score = 0;
  const stickerSetName = sticker.setName?.toLowerCase() ?? "";
  const emoji = sticker.emoji ?? "";
  const description = sticker.description?.toLowerCase() ?? "";

  if (input.setName) {
    if (stickerSetName === input.setName) {
      score += 20;
    } else if (stickerSetName.includes(input.setName)) {
      score += 10;
    } else {
      return 0;
    }
  }

  if (!input.query) {
    return score + 1;
  }

  if (description.includes(input.query)) {
    score += 10;
  }
  if (stickerSetName.includes(input.query)) {
    score += 6;
  }
  if (emoji && input.query.includes(emoji)) {
    score += 8;
  }

  const queryWords = input.query.split(/\s+/u).filter(Boolean);
  for (const word of queryWords) {
    if (description.includes(word)) {
      score += 4;
    }
    if (stickerSetName.includes(word)) {
      score += 2;
    }
  }

  return score;
}

function applyTelegramStickerStoreUpsert(
  store: TelegramStickerStoreFile,
  entry: {
    packId?: string;
    emoji?: string;
    fileId?: string;
    telegramSetName?: string;
  },
): TelegramStickerStoreFile {
  const packId = entry.packId?.trim() || "default";
  const packs = [...store.packs];
  const existingIndex = packs.findIndex((pack) => pack.id === packId);
  const basePack: TelegramStickerStorePack = existingIndex >= 0
    ? { ...packs[existingIndex]!, stickers: [...(packs[existingIndex]?.stickers ?? [])] }
    : { id: packId, stickers: [] };

  if (entry.telegramSetName?.trim()) {
    basePack.telegramSetName = entry.telegramSetName.trim();
  }

  if (entry.emoji?.trim() && entry.fileId?.trim()) {
    const nextStickers = [...(basePack.stickers ?? [])];
    const stickerIndex = nextStickers.findIndex((sticker) => sticker.emoji === entry.emoji!.trim());
    const nextSticker = { emoji: entry.emoji.trim(), fileId: entry.fileId.trim() };
    if (stickerIndex >= 0) {
      nextStickers[stickerIndex] = nextSticker;
    } else {
      nextStickers.push(nextSticker);
    }
    basePack.stickers = nextStickers;
  }

  const normalizedPack = normalizeStickerStorePacks([basePack])[0];
  if (!normalizedPack) {
    return store;
  }

  if (existingIndex >= 0) {
    packs.splice(existingIndex, 1, normalizedPack);
  } else {
    packs.push(normalizedPack);
  }

  return {
    version: 1,
    packs: normalizeStickerStorePacks(packs),
  };
}
