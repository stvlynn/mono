import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bot,
  Brain,
  ChevronRight,
  Cpu,
  FileCode2,
  FileJson,
  Menu,
  Puzzle,
  RefreshCw,
  Save,
  Send,
  Settings,
  TriangleAlert,
  User,
  X,
} from "lucide-react"
import {
  ApiError,
  deleteProfile,
  deleteProfileSecret,
  getBootstrap,
  getConfigSnapshot,
  getMemoryStatus,
  getModels,
  getProfiles,
  getSkills,
  getTelegramStatus,
  installSkill,
  refreshModels,
  saveGlobalConfig,
  saveProfile,
  searchSkills,
  setProfileSecret,
} from "@/api"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/toaster"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"
import { normalizeConfigAliases, parseJsonInput, serializeConfig } from "@/lib/config-ui"
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
} from "@/types"
import { ContextSection } from "./components/sections/ContextSection"
import { MemorySection } from "./components/sections/MemorySection"
import { ProfilesSection } from "./components/sections/ProfilesSection"
import { RawConfigSection } from "./components/sections/RawConfigSection"
import { SettingsSection } from "./components/sections/SettingsSection"
import { SkillsSection } from "./components/sections/SkillsSection"
import { TelegramSection } from "./components/sections/TelegramSection"

type Section = "profiles" | "settings" | "memory" | "context" | "telegram" | "skills" | "raw"

const sidebarItems: Array<{ id: Section; label: string; icon: typeof Bot }> = [
  { id: "profiles", label: "Profiles", icon: Bot },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "context", label: "Context", icon: FileCode2 },
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "skills", label: "Skills", icon: Puzzle },
  { id: "raw", label: "Raw JSON", icon: FileJson },
]

function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export default function App() {
  const [activeSection, setActiveSection] = useState<Section>("profiles")
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null)
  const [snapshot, setSnapshot] = useState<ConfigSnapshotResponse | null>(null)
  const [configDraft, setConfigDraft] = useState<GlobalConfig | null>(null)
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [models, setModels] = useState<ModelsResponse>({ models: [], profiles: [] })
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null)
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null)
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshingModelsState, setRefreshingModelsState] = useState(false)
  const [rawConfig, setRawConfig] = useState("")
  const [rawError, setRawError] = useState<string | null>(null)
  const [pendingBotToken, setPendingBotToken] = useState("")
  const [clearBotToken, setClearBotToken] = useState(false)
  const { toast } = useToast()

  const applySnapshot = useCallback((nextSnapshot: ConfigSnapshotResponse) => {
    setSnapshot(nextSnapshot)
    setConfigDraft(nextSnapshot.config)
    setRawConfig(serializeConfig(nextSnapshot.config))
    setRawError(null)
    setPendingBotToken("")
    setClearBotToken(false)
  }, [])

  const handleError = useCallback((error: unknown, fallback: string) => {
    const description = error instanceof Error ? error.message : fallback
    toast({
      title: "Request Failed",
      description,
      variant: "destructive",
    })
  }, [toast])

  const loadConfigState = useCallback(async () => {
    const [bootstrapData, snapshotData, profilesData, modelsData, memoryData, telegramData, skillsData] = await Promise.all([
      getBootstrap(),
      getConfigSnapshot(),
      getProfiles(),
      getModels(),
      getMemoryStatus(),
      getTelegramStatus(),
      getSkills(),
    ])

    setBootstrap(bootstrapData)
    applySnapshot(snapshotData)
    setProfiles(profilesData)
    setModels(modelsData)
    setMemoryStatus(memoryData)
    setTelegramStatus(telegramData)
    setSkills(skillsData)
  }, [applySnapshot])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        await loadConfigState()
      } catch (error) {
        if (!cancelled) {
          handleError(error, "Failed to load configuration UI data.")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [handleError, loadConfigState])

  useEffect(() => {
    if (!isMobileNavOpen) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileNavOpen(false)
      }
    }

    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [isMobileNavOpen])

  useEffect(() => {
    const root = document.documentElement
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const theme = configDraft?.mono.settings.appearance.theme ?? "system"

    const applyTheme = () => {
      const shouldUseDarkTheme = theme === "dark" || (theme === "system" && mediaQuery.matches)
      root.classList.toggle("dark", shouldUseDarkTheme)
      root.dataset.theme = theme
    }

    applyTheme()
    mediaQuery.addEventListener("change", applyTheme)
    return () => mediaQuery.removeEventListener("change", applyTheme)
  }, [configDraft?.mono.settings.appearance.theme])

  const updateDraft = useCallback((nextConfig: GlobalConfig) => {
    const normalized = normalizeConfigAliases(nextConfig)
    setConfigDraft(normalized)
    setRawConfig(serializeConfig(normalized))
    setRawError(null)
  }, [])

  const persistConfig = useCallback(async (nextConfig: GlobalConfig) => {
    if (!snapshot) {
      return
    }

    const nextSnapshot = await saveGlobalConfig({
      baseHash: snapshot.baseHash,
      config: nextConfig,
      sensitiveUpdates: {
        ...(pendingBotToken.trim() ? { "mono.channels.telegram.botToken": pendingBotToken.trim() } : {}),
        ...(clearBotToken ? { "mono.channels.telegram.botToken": null } : {}),
      },
    })
    applySnapshot(nextSnapshot)
    setProfiles(await getProfiles())
    setMemoryStatus(await getMemoryStatus())
    setTelegramStatus(await getTelegramStatus())
  }, [applySnapshot, clearBotToken, pendingBotToken, snapshot])

  const saveStructuredConfig = useCallback(async () => {
    if (!configDraft || !snapshot) {
      return
    }

    setSaving(true)
    try {
      await persistConfig(configDraft)
      toast({
        title: "Config Saved",
        description: "Global config.json was written and the reload signal was emitted.",
      })
    } catch (error) {
      handleError(error, "Failed to save config.")
      if (isApiError(error) && error.status === 409) {
        try {
          applySnapshot(await getConfigSnapshot())
          setProfiles(await getProfiles())
        } catch {
          // Ignore secondary refresh failures; the destructive toast above is enough.
        }
      }
    } finally {
      setSaving(false)
    }
  }, [configDraft, handleError, persistConfig, snapshot, toast])

  const saveRawConfig = useCallback(async () => {
    const parsed = parseJsonInput<GlobalConfig>(rawConfig)
    if (!parsed.value) {
      setRawError(parsed.error ?? "Invalid JSON.")
      return
    }
    const normalized = normalizeConfigAliases(parsed.value)
    setConfigDraft(normalized)
    setRawError(null)
    setSaving(true)
    try {
      await persistConfig(normalized)
      toast({
        title: "Raw Config Saved",
        description: "The global config snapshot was updated from the raw editor.",
      })
    } catch (error) {
      handleError(error, "Failed to save raw config.")
    } finally {
      setSaving(false)
    }
  }, [handleError, persistConfig, rawConfig, toast])

  const handleSave = useCallback(async () => {
    if (activeSection === "raw") {
      await saveRawConfig()
      return
    }
    await saveStructuredConfig()
  }, [activeSection, saveRawConfig, saveStructuredConfig])

  const refreshModelCatalog = useCallback(async () => {
    setRefreshingModelsState(true)
    try {
      const nextModels = await refreshModels()
      setModels(nextModels)
      toast({
        title: "Model Catalog Refreshed",
        description: `${nextModels.models.length} models are now available in the UI.`,
      })
    } catch (error) {
      handleError(error, "Failed to refresh model catalog.")
    } finally {
      setRefreshingModelsState(false)
    }
  }, [handleError, toast])

  const handleRawChange = useCallback((value: string) => {
    setRawConfig(value)
    const parsed = parseJsonInput<GlobalConfig>(value)
    if (parsed.value) {
      setConfigDraft(normalizeConfigAliases(parsed.value))
      setRawError(null)
      return
    }
    setRawError(parsed.error ?? "Invalid JSON.")
  }, [])

  const isDirty = useMemo(() => {
    if (!snapshot || !configDraft) {
      return false
    }
    return serializeConfig(configDraft) !== serializeConfig(snapshot.config) || Boolean(pendingBotToken.trim()) || clearBotToken
  }, [clearBotToken, configDraft, pendingBotToken, snapshot])

  const saveProfileMutation = useCallback(async (
    currentName: string,
    payload: { baseHash: string; profile: ProfileConfig; newName?: string; setDefault?: boolean }
  ) => {
    try {
      await saveProfile(currentName, payload)
      applySnapshot(await getConfigSnapshot())
      setProfiles(await getProfiles())
      toast({
        title: "Profile Saved",
        description: payload.newName ? `Saved profile ${payload.newName}.` : `Saved profile ${currentName}.`,
      })
    } catch (error) {
      handleError(error, "Failed to save profile.")
      throw error
    }
  }, [applySnapshot, handleError, toast])

  const deleteProfileMutation = useCallback(async (name: string, baseHash: string) => {
    try {
      await deleteProfile(name, baseHash)
      applySnapshot(await getConfigSnapshot())
      setProfiles(await getProfiles())
      toast({
        title: "Profile Deleted",
        description: `Removed ${name} from global config.`,
      })
    } catch (error) {
      handleError(error, "Failed to delete profile.")
      throw error
    }
  }, [applySnapshot, handleError, toast])

  const setSecretMutation = useCallback(async (name: string, baseHash: string, secret: string) => {
    try {
      await setProfileSecret(name, baseHash, secret)
      applySnapshot(await getConfigSnapshot())
      setProfiles(await getProfiles())
      toast({
        title: "Secret Saved",
        description: `Stored a local secret for ${name}.`,
      })
    } catch (error) {
      handleError(error, "Failed to save local secret.")
      throw error
    }
  }, [applySnapshot, handleError, toast])

  const deleteSecretMutation = useCallback(async (name: string, baseHash: string) => {
    try {
      await deleteProfileSecret(name, baseHash)
      applySnapshot(await getConfigSnapshot())
      setProfiles(await getProfiles())
      toast({
        title: "Secret Removed",
        description: `Cleared the local secret for ${name}.`,
      })
    } catch (error) {
      handleError(error, "Failed to clear local secret.")
      throw error
    }
  }, [applySnapshot, handleError, toast])

  const searchSkillsMutation = useCallback(async (query: string): Promise<SkillSearchResult[]> => {
    try {
      return (await searchSkills(query)).results
    } catch (error) {
      handleError(error, "Failed to search the remote skills registry.")
      throw error
    }
  }, [handleError])

  const installSkillMutation = useCallback(async (source: string) => {
    try {
      await installSkill(source)
      setSkills(await getSkills())
      toast({
        title: "Skill Installed",
        description: source,
      })
    } catch (error) {
      handleError(error, "Failed to install skill.")
      throw error
    }
  }, [handleError, toast])

  const activeLabel = sidebarItems.find((item) => item.id === activeSection)?.label ?? "Config"
  const headerActionDisabled = saving || loading || !configDraft || !snapshot || (activeSection === "raw" && Boolean(rawError))

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <Toaster />

      {isMobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      <aside
        id="settings-navigation"
        aria-label="Configuration sections"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r bg-muted/95 backdrop-blur transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:max-w-none lg:translate-x-0 lg:bg-muted/30",
          isMobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-2 border-b p-6">
          <div className="rounded-lg bg-primary p-1.5 text-primary-foreground">
            <Cpu size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">Mono Config</h1>
            <p className="truncate text-xs text-muted-foreground">Real config + secrets backend</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            aria-label="Close navigation"
            onClick={() => setIsMobileNavOpen(false)}
          >
            <X size={18} />
          </Button>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto p-4">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={activeSection === item.id ? "page" : undefined}
              onClick={() => {
                setActiveSection(item.id)
                setIsMobileNavOpen(false)
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                activeSection === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
              {activeSection === item.id && <ChevronRight size={16} className="ml-auto" />}
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t p-4">
          <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <User size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{bootstrap?.resolvedProfile ?? "Loading profile…"}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                {bootstrap?.globalConfigPath ?? "Loading config path…"}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <main className="w-full flex-1">
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <header className="mb-8 space-y-4">
            <div className="flex items-center justify-between lg:hidden">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                aria-controls="settings-navigation"
                aria-expanded={isMobileNavOpen}
                onClick={() => setIsMobileNavOpen((open) => !open)}
              >
                <Menu size={18} />
                Sections
              </Button>
              <div className="text-right">
                <p className="text-sm font-semibold">Mono Config</p>
                <p className="text-xs text-muted-foreground">Global config + secrets</p>
              </div>
            </div>

            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">{activeLabel}</h2>
                <p className="text-muted-foreground">
                  Edit the materialized global config snapshot, manage local secrets, and inspect nearby runtime status.
                </p>
                {bootstrap?.projectConfigExists && (
                  <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100">
                    <TriangleAlert size={18} className="mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium">Project override detected</p>
                      <p>
                        The current workspace has <span className="font-mono">{bootstrap.projectConfigPath}</span>. This UI edits only the global config, so resolved behavior may still be overridden by project settings.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {loading ? "Loading…" : isDirty ? "Unsaved changes" : "All changes saved"}
                </div>
                <Button className="gap-2" onClick={handleSave} disabled={headerActionDisabled}>
                  {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                  {activeSection === "raw" ? "Save Raw JSON" : "Save Changes"}
                </Button>
              </div>
            </div>
          </header>

          {loading || !configDraft || !snapshot ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed">
              <div className="space-y-2 text-center">
                <RefreshCw size={24} className="mx-auto animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading configuration state…</p>
              </div>
            </div>
          ) : (
            <>
              {activeSection === "profiles" && (
                <ProfilesSection
                  profiles={profiles}
                  models={models.models}
                  baseHash={snapshot.baseHash}
                  saving={saving}
                  refreshingModels={refreshingModelsState}
                  onSaveProfile={saveProfileMutation}
                  onDeleteProfile={deleteProfileMutation}
                  onSetSecret={setSecretMutation}
                  onDeleteSecret={deleteSecretMutation}
                  onRefreshModels={refreshModelCatalog}
                />
              )}

              {activeSection === "settings" && (
                <SettingsSection
                  config={configDraft.mono.settings}
                  onChange={(settings) =>
                    updateDraft({
                      ...configDraft,
                      mono: {
                        ...configDraft.mono,
                        settings,
                      },
                    })
                  }
                />
              )}

              {activeSection === "memory" && (
                <MemorySection
                  config={configDraft.mono.memory}
                  status={memoryStatus}
                  onChange={(memory) =>
                    updateDraft({
                      ...configDraft,
                      mono: {
                        ...configDraft.mono,
                        memory,
                      },
                    })
                  }
                />
              )}

              {activeSection === "context" && (
                <ContextSection
                  config={configDraft.mono.context}
                  onChange={(context) =>
                    updateDraft({
                      ...configDraft,
                      mono: {
                        ...configDraft.mono,
                        context,
                      },
                    })
                  }
                />
              )}

              {activeSection === "telegram" && (
                <TelegramSection
                  config={configDraft.mono.channels.telegram}
                  status={telegramStatus}
                  pendingBotToken={pendingBotToken}
                  onPendingBotTokenChange={(value) => {
                    setPendingBotToken(value)
                    setClearBotToken(false)
                  }}
                  onClearBotToken={() => {
                    setPendingBotToken("")
                    setClearBotToken(true)
                  }}
                  onChange={(telegram) =>
                    updateDraft({
                      ...configDraft,
                      mono: {
                        ...configDraft.mono,
                        channels: {
                          ...configDraft.mono.channels,
                          telegram,
                        },
                      },
                    })
                  }
                />
              )}

              {activeSection === "skills" && (
                <SkillsSection
                  skills={skills}
                  loading={loading}
                  onSearchSkills={searchSkillsMutation}
                  onInstallSkill={installSkillMutation}
                />
              )}

              {activeSection === "raw" && (
                <RawConfigSection
                  value={rawConfig}
                  configPath={snapshot.configPath}
                  error={rawError}
                  saving={saving}
                  onChange={handleRawChange}
                  onReset={() => applySnapshot(snapshot)}
                  onSave={saveRawConfig}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
