import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getMonoConfigSummary,
  hashConfigUiSnapshot,
  listConfigUiProfiles,
  loadConfigUiGlobalSnapshot,
  materializeGlobalConfig,
  MonoConfigStore,
  readMaterializedGlobalConfig,
  resolveMonoConfig,
  validateAndMaterializeGlobalConfig,
  writeConfigUiReloadSignal,
  writeValidatedGlobalConfig,
} from "@mono/config";
import type {
  ConfigUiBootstrapResponse,
  ConfigUiDeleteProfileRequest,
  ConfigUiDeleteProfileSecretRequest,
  ConfigUiSaveGlobalConfigRequest,
  ConfigUiSaveProfileRequest,
  ConfigUiSetProfileSecretRequest,
  MonoGlobalConfig,
} from "@mono/shared";
import { runMemoryStatus } from "../use-cases/memory-core.js";
import { runModelsList } from "../use-cases/models.js";
import { runSkillsAdd, runSkillsFind, runSkillsList } from "../use-cases/skills.js";
import { runTelegramStatus } from "../use-cases/telegram.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveStaticRoot(): Promise<string | null> {
  const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
  const candidates = [
    resolve(here, "../../../web-config/dist"),
    resolve(here, "../web-config"),
    resolve(process.cwd(), "packages/web-config/dist"),
  ];

  for (const candidate of candidates) {
    if (await exists(join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return null;
}

function json<T>(response: ServerResponse, statusCode: number, payload: T): void {
  response.writeHead(statusCode, {
    "Content-Type": JSON_CONTENT_TYPE,
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function noContent(response: ServerResponse): void {
  response.writeHead(204);
  response.end();
}

function getRequestPath(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://127.0.0.1");
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new HttpError(400, "Request body is required.");
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function getMimeType(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return JSON_CONTENT_TYPE;
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function serveStaticFile(response: ServerResponse, root: string, pathname: string): Promise<void> {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = resolve(root, `.${normalized}`);
  const resolvedRoot = resolve(root);

  if (!resolvedPath.startsWith(resolvedRoot)) {
    throw new HttpError(403, "Invalid asset path.");
  }

  let filePath = resolvedPath;
  if (!await exists(resolvedPath)) {
    if (extname(normalized)) {
      throw new HttpError(404, `Static asset not found: ${pathname}`);
    }
    filePath = join(root, "index.html");
  }
  const payload = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": getMimeType(filePath),
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=300",
  });
  response.end(payload);
}

async function buildBootstrapResponse(cwd: string): Promise<ConfigUiBootstrapResponse> {
  const store = new MonoConfigStore(cwd);
  const [summary, resolved, projectConfig] = await Promise.all([
    getMonoConfigSummary(cwd),
    resolveMonoConfig({ cwd }),
    store.readProjectConfig(),
  ]);

  return {
    globalConfigPath: store.paths.globalConfigPath,
    globalSecretsPath: store.paths.globalSecretsPath,
    projectConfigPath: store.paths.projectConfigPath,
    projectConfigExists: Boolean(projectConfig),
    summary,
    resolvedProfile: resolved.profileName,
    profileSource: resolved.source.profile,
    apiKeySource: resolved.source.apiKey,
  };
}

async function assertBaseHash(cwd: string, baseHash: string): Promise<MonoGlobalConfig> {
  const current = await readMaterializedGlobalConfig(cwd);
  const currentHash = hashConfigUiSnapshot(current);

  if (baseHash !== currentHash) {
    throw new HttpError(409, "Configuration changed on disk. Reload and retry.");
  }

  return current;
}

function normalizeProfileName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, "Profile name is required.");
  }
  return trimmed;
}

async function saveProfile(
  cwd: string,
  currentName: string,
  body: ConfigUiSaveProfileRequest
): Promise<void> {
  const store = new MonoConfigStore(cwd);
  const current = await assertBaseHash(cwd, body.baseHash);
  const nextName = normalizeProfileName(body.newName ?? currentName);
  const currentProfile = current.mono.profiles[currentName];
  if (!currentProfile && currentName !== nextName) {
    throw new HttpError(404, `Profile "${currentName}" was not found.`);
  }
  if (nextName !== currentName && current.mono.profiles[nextName]) {
    throw new HttpError(409, `Profile "${nextName}" already exists.`);
  }

  const nextConfig = materializeGlobalConfig(current, { cwd });
  if (currentProfile && nextName !== currentName) {
    delete nextConfig.mono.profiles[currentName];
  }
  nextConfig.mono.profiles[nextName] = {
    ...body.profile,
    apiKeyRef:
      nextName !== currentName && body.profile.apiKeyRef === `local:${currentName}`
        ? `local:${nextName}`
        : body.profile.apiKeyRef,
  };
  if (body.setDefault || (currentProfile && nextConfig.mono.defaultProfile === currentName)) {
    nextConfig.mono.defaultProfile = nextName;
  }

  const validated = await validateAndMaterializeGlobalConfig(nextConfig, { cwd });
  await store.writeGlobalConfig(validated);

  if (currentProfile && nextName !== currentName) {
    const secrets = (await store.readSecrets()) ?? { version: 1, profiles: {} };
    if (secrets.profiles[currentName]) {
      secrets.profiles[nextName] = secrets.profiles[currentName]!;
      delete secrets.profiles[currentName];
      await store.writeSecrets(secrets);
    }
  }

  await writeConfigUiReloadSignal(cwd, "profile-save");
}

async function deleteProfile(
  cwd: string,
  profileName: string,
  body: ConfigUiDeleteProfileRequest
): Promise<void> {
  const store = new MonoConfigStore(cwd);
  const current = await assertBaseHash(cwd, body.baseHash);
  if (!current.mono.profiles[profileName]) {
    throw new HttpError(404, `Profile "${profileName}" was not found.`);
  }

  const nextConfig = materializeGlobalConfig(current, { cwd });
  delete nextConfig.mono.profiles[profileName];
  if (Object.keys(nextConfig.mono.profiles).length === 0) {
    throw new HttpError(400, "At least one profile must remain configured.");
  }
  if (nextConfig.mono.defaultProfile === profileName) {
    nextConfig.mono.defaultProfile = Object.keys(nextConfig.mono.profiles)[0]!;
  }

  const validated = await validateAndMaterializeGlobalConfig(nextConfig, { cwd });
  await store.writeGlobalConfig(validated);
  await store.deleteProfileSecret(profileName);
  await writeConfigUiReloadSignal(cwd, "profile-delete");
}

async function setProfileSecret(
  cwd: string,
  profileName: string,
  body: ConfigUiSetProfileSecretRequest
): Promise<void> {
  const store = new MonoConfigStore(cwd);
  const current = await assertBaseHash(cwd, body.baseHash);
  const profile = current.mono.profiles[profileName];
  if (!profile) {
    throw new HttpError(404, `Profile "${profileName}" was not found.`);
  }

  if (!body.secret.trim()) {
    throw new HttpError(400, "Secret value is required.");
  }

  const nextConfig = materializeGlobalConfig(current, { cwd });
  nextConfig.mono.profiles[profileName] = {
    ...profile,
    apiKeyRef: `local:${profileName}`,
  };

  const validated = await validateAndMaterializeGlobalConfig(nextConfig, { cwd });
  await store.writeGlobalConfig(validated);
  await store.setProfileSecret(profileName, body.secret.trim());
  await writeConfigUiReloadSignal(cwd, "profile-secret-set");
}

async function deleteProfileSecret(
  cwd: string,
  profileName: string,
  body: ConfigUiDeleteProfileSecretRequest
): Promise<void> {
  const store = new MonoConfigStore(cwd);
  const current = await assertBaseHash(cwd, body.baseHash);
  const profile = current.mono.profiles[profileName];
  if (!profile) {
    throw new HttpError(404, `Profile "${profileName}" was not found.`);
  }

  const nextConfig = materializeGlobalConfig(current, { cwd });
  nextConfig.mono.profiles[profileName] = {
    ...profile,
    apiKeyRef: profile.apiKeyRef === `local:${profileName}` ? undefined : profile.apiKeyRef,
  };

  const validated = await validateAndMaterializeGlobalConfig(nextConfig, { cwd });
  await store.writeGlobalConfig(validated);
  await store.deleteProfileSecret(profileName);
  await writeConfigUiReloadSignal(cwd, "profile-secret-delete");
}

async function handleApiRequest(
  cwd: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<boolean> {
  const url = getRequestPath(request);
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  const method = request.method ?? "GET";

  try {
    if (method === "GET" && url.pathname === "/api/bootstrap") {
      json(response, 200, await buildBootstrapResponse(cwd));
      return true;
    }

    if (method === "GET" && url.pathname === "/api/config/global") {
      json(response, 200, await loadConfigUiGlobalSnapshot(cwd));
      return true;
    }

    if (method === "PUT" && url.pathname === "/api/config/global") {
      const body = await readJsonBody<ConfigUiSaveGlobalConfigRequest>(request);
      await assertBaseHash(cwd, body.baseHash);
      await writeValidatedGlobalConfig(body.config, {
        cwd,
        sensitiveUpdates: body.sensitiveUpdates,
      });
      await writeConfigUiReloadSignal(cwd, "config-save");
      json(response, 200, await loadConfigUiGlobalSnapshot(cwd));
      return true;
    }

    if (method === "GET" && url.pathname === "/api/models") {
      json(response, 200, await runModelsList());
      return true;
    }

    if (method === "POST" && url.pathname === "/api/models/refresh") {
      json(response, 200, await runModelsList(undefined, true));
      return true;
    }

    if (method === "GET" && url.pathname === "/api/profiles") {
      json(response, 200, { profiles: await listConfigUiProfiles(cwd) });
      return true;
    }

    const profileSaveMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)$/u);
    if (profileSaveMatch && method === "PUT") {
      await saveProfile(cwd, decodeURIComponent(profileSaveMatch[1] ?? ""), await readJsonBody<ConfigUiSaveProfileRequest>(request));
      noContent(response);
      return true;
    }

    if (profileSaveMatch && method === "DELETE") {
      await deleteProfile(
        cwd,
        decodeURIComponent(profileSaveMatch[1] ?? ""),
        await readJsonBody<ConfigUiDeleteProfileRequest>(request)
      );
      noContent(response);
      return true;
    }

    const profileSecretMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/secret$/u);
    if (profileSecretMatch && method === "PUT") {
      await setProfileSecret(
        cwd,
        decodeURIComponent(profileSecretMatch[1] ?? ""),
        await readJsonBody<ConfigUiSetProfileSecretRequest>(request)
      );
      noContent(response);
      return true;
    }

    if (profileSecretMatch && method === "DELETE") {
      await deleteProfileSecret(
        cwd,
        decodeURIComponent(profileSecretMatch[1] ?? ""),
        await readJsonBody<ConfigUiDeleteProfileSecretRequest>(request)
      );
      noContent(response);
      return true;
    }

    if (method === "GET" && url.pathname === "/api/status/memory") {
      json(response, 200, await runMemoryStatus());
      return true;
    }

    if (method === "GET" && url.pathname === "/api/status/telegram") {
      json(response, 200, await runTelegramStatus());
      return true;
    }

    if (method === "GET" && url.pathname === "/api/skills") {
      json(response, 200, await runSkillsList());
      return true;
    }

    if (method === "POST" && url.pathname === "/api/skills/search") {
      const body = await readJsonBody<{ query?: string }>(request);
      json(response, 200, await runSkillsFind(body.query ?? ""));
      return true;
    }

    if (method === "POST" && url.pathname === "/api/skills/install") {
      const body = await readJsonBody<{ source?: string }>(request);
      if (!body.source?.trim()) {
        throw new HttpError(400, "Skill source is required.");
      }
      json(response, 200, await runSkillsAdd(body.source.trim(), { cwd }));
      return true;
    }

    throw new HttpError(404, `Unknown API route: ${method} ${url.pathname}`);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    json(response, statusCode, {
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

function openUrlInBrowser(url: string): void {
  const spawnAndForget = (command: string, args: string[]) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  };

  const platform = process.platform;
  if (platform === "darwin") {
    spawnAndForget("open", [url]);
    return;
  }

  if (platform === "win32") {
    spawnAndForget("cmd", ["/c", "start", "", url]);
    return;
  }

  spawnAndForget("xdg-open", [url]);
}

export interface StartConfigUiServerOptions {
  cwd?: string;
  host?: string;
  port?: number;
  apiOnly?: boolean;
  openBrowser?: boolean;
}

export async function startConfigUiServer(options: StartConfigUiServerOptions = {}): Promise<{
  server: Server;
  url: string;
}> {
  const cwd = options.cwd ?? process.cwd();
  const host = options.host ?? "127.0.0.1";
  const port = parsePort(options.port?.toString(), 5173);
  const staticRoot = options.apiOnly ? null : await resolveStaticRoot();

  if (!options.apiOnly && !staticRoot) {
    throw new Error("Could not find web-config build output. Run `pnpm --dir packages/web-config build` first.");
  }

  const server = createServer(async (request, response) => {
    if (await handleApiRequest(cwd, request, response)) {
      return;
    }

    if (options.apiOnly) {
      json(response, 404, { error: "Static UI is disabled in --api-only mode." });
      return;
    }

    try {
      await serveStaticFile(response, staticRoot!, getRequestPath(request).pathname);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      json(response, statusCode, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  const url = `http://${host}:${port}/`;
  if (options.openBrowser) {
    openUrlInBrowser(url);
  }

  return { server, url };
}
