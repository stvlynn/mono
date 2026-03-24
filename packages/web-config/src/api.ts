import type {
  BootstrapResponse,
  ConfigSnapshotResponse,
  GlobalConfig,
  MemoryStatus,
  ModelsResponse,
  ProfileConfig,
  ProfileSummary,
  SkillRecord,
  SkillSearchResult,
  TelegramStatus,
} from "./types"

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ApiError"
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (response.status === 204) {
    return undefined as T
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(response.status, typeof payload.error === "string" ? payload.error : "Request failed")
  }

  return payload as T
}

export function getBootstrap() {
  return request<BootstrapResponse>("/api/bootstrap")
}

export function getConfigSnapshot() {
  return request<ConfigSnapshotResponse>("/api/config/global")
}

export function saveGlobalConfig(body: {
  baseHash: string
  config: GlobalConfig
  sensitiveUpdates?: Record<string, string | null>
}) {
  return request<ConfigSnapshotResponse>("/api/config/global", {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export async function getProfiles() {
  const response = await request<{ profiles: ProfileSummary[] }>("/api/profiles")
  return response.profiles
}

export function saveProfile(
  currentName: string,
  body: {
    baseHash: string
    profile: ProfileConfig
    newName?: string
    setDefault?: boolean
  }
) {
  return request<void>(`/api/profiles/${encodeURIComponent(currentName)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export function deleteProfile(currentName: string, baseHash: string) {
  return request<void>(`/api/profiles/${encodeURIComponent(currentName)}`, {
    method: "DELETE",
    body: JSON.stringify({ baseHash }),
  })
}

export function setProfileSecret(currentName: string, baseHash: string, secret: string) {
  return request<void>(`/api/profiles/${encodeURIComponent(currentName)}/secret`, {
    method: "PUT",
    body: JSON.stringify({ baseHash, secret }),
  })
}

export function deleteProfileSecret(currentName: string, baseHash: string) {
  return request<void>(`/api/profiles/${encodeURIComponent(currentName)}/secret`, {
    method: "DELETE",
    body: JSON.stringify({ baseHash }),
  })
}

export function getModels() {
  return request<ModelsResponse>("/api/models")
}

export function refreshModels() {
  return request<ModelsResponse>("/api/models/refresh", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function getMemoryStatus() {
  return request<MemoryStatus>("/api/status/memory")
}

export function getTelegramStatus() {
  return request<TelegramStatus>("/api/status/telegram")
}

export async function getSkills() {
  const response = await request<{ skills: SkillRecord[] }>("/api/skills")
  return response.skills
}

export function searchSkills(query: string) {
  return request<{ query: string; results: SkillSearchResult[] }>("/api/skills/search", {
    method: "POST",
    body: JSON.stringify({ query }),
  })
}

export function installSkill(source: string) {
  return request<{ skill: SkillRecord; installDir: string; metadataPath: string; replacedExisting: boolean }>(
    "/api/skills/install",
    {
      method: "POST",
      body: JSON.stringify({ source }),
    }
  )
}
