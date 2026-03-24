import { useEffect, useMemo, useState } from "react"
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { buildProfileFromModel, createFallbackProfile, getModelsForProvider, getProviderOptions } from "@/lib/config-ui"
import type { ProfileConfig, ProfileSummary, UnifiedModel } from "@/types"

interface ProfilesSectionProps {
  profiles: ProfileSummary[]
  models: UnifiedModel[]
  baseHash: string
  saving: boolean
  refreshingModels: boolean
  onSaveProfile: (
    currentName: string,
    payload: { baseHash: string; profile: ProfileConfig; newName?: string; setDefault?: boolean }
  ) => Promise<void>
  onDeleteProfile: (name: string, baseHash: string) => Promise<void>
  onSetSecret: (name: string, baseHash: string, secret: string) => Promise<void>
  onDeleteSecret: (name: string, baseHash: string) => Promise<void>
  onRefreshModels: () => Promise<void>
}

interface EditableProfile {
  currentName?: string
  name: string
  profile: ProfileConfig
  setDefault: boolean
}

const selectClassName =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

function createEditableProfile(summary: ProfileSummary): EditableProfile {
  return {
    currentName: summary.name,
    name: summary.name,
    profile: summary.profile,
    setDefault: summary.isDefault,
  }
}

export function ProfilesSection({
  profiles,
  models,
  baseHash,
  saving,
  refreshingModels,
  onSaveProfile,
  onDeleteProfile,
  onSetSecret,
  onDeleteSecret,
  onRefreshModels,
}: ProfilesSectionProps) {
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(profiles[0]?.name ?? null)
  const [draft, setDraft] = useState<EditableProfile | null>(profiles[0] ? createEditableProfile(profiles[0]) : null)
  const [pendingSecret, setPendingSecret] = useState("")

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedProfileName(null)
      setDraft(null)
      return
    }

    if (!selectedProfileName || !profiles.some((profile) => profile.name === selectedProfileName)) {
      const next = profiles[0]!
      setSelectedProfileName(next.name)
      setDraft(createEditableProfile(next))
      return
    }

    const selected = profiles.find((profile) => profile.name === selectedProfileName)
    if (selected && draft?.currentName === selected.name) {
      setDraft(createEditableProfile(selected))
    }
  }, [draft?.currentName, profiles, selectedProfileName])

  const providerOptions = useMemo(
    () => getProviderOptions(models, profiles.map((profile) => profile.profile)),
    [models, profiles]
  )

  const availableModels = useMemo(
    () => (draft ? getModelsForProvider(models, draft.profile.provider) : []),
    [draft, models]
  )

  const selectedSummary = draft?.currentName
    ? profiles.find((profile) => profile.name === draft.currentName)
    : undefined

  const updateDraftProfile = (patch: Partial<ProfileConfig>) => {
    setDraft((current) => current ? { ...current, profile: { ...current.profile, ...patch } } : current)
  }

  const startCreateProfile = () => {
    const seedModel = models[0]
    setSelectedProfileName(null)
    setPendingSecret("")
    setDraft({
      name: "",
      profile: seedModel ? buildProfileFromModel(seedModel) : createFallbackProfile(),
      setDefault: profiles.length === 0,
    })
  }

  const selectExistingProfile = (name: string) => {
    const selected = profiles.find((profile) => profile.name === name)
    if (!selected) {
      return
    }
    setSelectedProfileName(name)
    setPendingSecret("")
    setDraft(createEditableProfile(selected))
  }

  const handleProviderChange = (provider: string) => {
    if (!draft) {
      return
    }

    const providerModels = getModelsForProvider(models, provider)
    if (providerModels[0]) {
      setDraft({
        ...draft,
        profile: {
          ...buildProfileFromModel(providerModels[0]),
          apiKeyEnv: draft.profile.apiKeyEnv,
          apiKeyRef: draft.profile.apiKeyRef,
        },
      })
      return
    }

    updateDraftProfile(createFallbackProfile(provider))
  }

  const handleModelSelection = (modelId: string) => {
    if (!draft) {
      return
    }

    const selectedModel = availableModels.find((model) => model.modelId === modelId)
    if (!selectedModel) {
      updateDraftProfile({ modelId })
      return
    }

    setDraft({
      ...draft,
      profile: {
        ...buildProfileFromModel(selectedModel),
        apiKeyEnv: draft.profile.apiKeyEnv,
        apiKeyRef: draft.profile.apiKeyRef,
      },
    })
  }

  const saveProfile = async () => {
    if (!draft) {
      return
    }

    await onSaveProfile(draft.currentName ?? draft.name, {
      baseHash,
      profile: draft.profile,
      newName: draft.name,
      setDefault: draft.setDefault,
    })
    setPendingSecret("")
    setSelectedProfileName(draft.name)
  }

  const deleteSelectedProfile = async () => {
    if (!draft?.currentName) {
      return
    }
    await onDeleteProfile(draft.currentName, baseHash)
    setPendingSecret("")
  }

  const saveSecret = async () => {
    if (!draft?.name || !pendingSecret.trim()) {
      return
    }
    await onSetSecret(draft.name, baseHash, pendingSecret)
    setPendingSecret("")
  }

  const clearSecret = async () => {
    if (!draft?.name) {
      return
    }
    await onDeleteSecret(draft.name, baseHash)
    setPendingSecret("")
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Configured Profiles</h3>
          <Button variant="outline" size="sm" className="gap-2" onClick={onRefreshModels} disabled={refreshingModels}>
            <RefreshCw size={14} className={refreshingModels ? "animate-spin" : ""} />
            Refresh Models
          </Button>
        </div>

        <div className="space-y-3">
          {profiles.map((profile) => (
            <button
              key={profile.name}
              type="button"
              className={`w-full rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                draft?.currentName === profile.name ? "border-primary bg-primary/5" : "hover:bg-muted/40"
              }`}
              onClick={() => selectExistingProfile(profile.name)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 overflow-hidden">
                  <p className="truncate font-medium">{profile.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {profile.profile.provider} / {profile.profile.modelId}
                  </p>
                </div>
                <div className="space-y-1 text-right">
                  {profile.isDefault && (
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Default
                    </span>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {profile.hasSecret ? "Local secret" : profile.profile.apiKeyEnv ? `Env: ${profile.profile.apiKeyEnv}` : "No key source"}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <Button className="w-full gap-2" onClick={startCreateProfile}>
          <Plus size={16} />
          Add Profile
        </Button>
      </div>

      {draft ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{draft.currentName ? "Edit Profile" : "Create Profile"}</CardTitle>
              <CardDescription>Profiles map provider/model selection to reusable config entries.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="profile-name">Profile Name</Label>
                  <Input
                    id="profile-name"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-provider">Provider</Label>
                  <select
                    id="profile-provider"
                    className={selectClassName}
                    value={draft.profile.provider}
                    onChange={(event) => handleProviderChange(event.target.value)}
                  >
                    {providerOptions.map((provider) => (
                      <option key={provider} value={provider}>{provider}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-model-select">Catalog Model</Label>
                  <select
                    id="profile-model-select"
                    className={selectClassName}
                    value={availableModels.some((model) => model.modelId === draft.profile.modelId) ? draft.profile.modelId : ""}
                    onChange={(event) => handleModelSelection(event.target.value)}
                  >
                    <option value="">Custom / keep current</option>
                    {availableModels.map((model) => (
                      <option key={`${model.provider}/${model.modelId}`} value={model.modelId}>
                        {model.modelId}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-model-id">Model ID</Label>
                  <Input
                    id="profile-model-id"
                    value={draft.profile.modelId}
                    onChange={(event) => updateDraftProfile({ modelId: event.target.value })}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="profile-base-url">Base URL</Label>
                  <Input
                    id="profile-base-url"
                    value={draft.profile.baseURL}
                    onChange={(event) => updateDraftProfile({ baseURL: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-api-key-env">API Key Env</Label>
                  <Input
                    id="profile-api-key-env"
                    value={draft.profile.apiKeyEnv ?? ""}
                    onChange={(event) => updateDraftProfile({ apiKeyEnv: event.target.value || undefined })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-runtime-provider-key">Runtime Provider Key</Label>
                  <Input
                    id="profile-runtime-provider-key"
                    value={draft.profile.runtimeProviderKey ?? ""}
                    onChange={(event) => updateDraftProfile({ runtimeProviderKey: event.target.value || undefined })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-context-window">Context Window</Label>
                  <Input
                    id="profile-context-window"
                    type="number"
                    min="0"
                    value={draft.profile.contextWindow ?? ""}
                    onChange={(event) => updateDraftProfile({ contextWindow: event.target.value ? Number(event.target.value) : undefined })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-family">Model Family</Label>
                  <select
                    id="profile-family"
                    className={selectClassName}
                    value={draft.profile.family}
                    onChange={(event) =>
                      updateDraftProfile({ family: event.target.value as ProfileConfig["family"] })
                    }
                  >
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <Label htmlFor="profile-default">Set As Default</Label>
                  <Switch
                    id="profile-default"
                    checked={draft.setDefault}
                    onCheckedChange={(checked) => setDraft({ ...draft, setDefault: checked })}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <Label htmlFor="profile-tools">Supports Tools</Label>
                  <Switch
                    id="profile-tools"
                    checked={draft.profile.supportsTools}
                    onCheckedChange={(checked) => updateDraftProfile({ supportsTools: checked })}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <Label htmlFor="profile-reasoning">Supports Reasoning</Label>
                  <Switch
                    id="profile-reasoning"
                    checked={draft.profile.supportsReasoning}
                    onCheckedChange={(checked) => updateDraftProfile({ supportsReasoning: checked })}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <Label htmlFor="profile-attachments">Supports Attachments</Label>
                  <Switch
                    id="profile-attachments"
                    checked={Boolean(draft.profile.supportsAttachments)}
                    onCheckedChange={(checked) => updateDraftProfile({ supportsAttachments: checked })}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <div className="text-xs text-muted-foreground">
                {selectedSummary?.hasSecret ? "Using local secret storage." : draft.profile.apiKeyEnv ? `Using env var ${draft.profile.apiKeyEnv}.` : "No API key source configured."}
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                {draft.currentName && (
                  <Button variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={deleteSelectedProfile}>
                    <Trash2 size={16} />
                    Delete
                  </Button>
                )}
                <Button className="flex-1 sm:flex-none" onClick={saveProfile} disabled={saving || !draft.name.trim() || !draft.profile.modelId.trim()}>
                  {saving ? "Saving…" : draft.currentName ? "Save Profile" : "Create Profile"}
                </Button>
              </div>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound size={18} />
                Secret Management
              </CardTitle>
              <CardDescription>Store local API keys separately from config.json.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {selectedSummary?.hasSecret
                  ? "A local secret already exists for this profile."
                  : "No local secret stored yet. Saving one will write to ~/.mono/local/secrets.json and set apiKeyRef."}
              </p>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Input
                  type="password"
                  placeholder={draft.currentName ? "Paste a new API key" : "Save the profile first to manage a local secret"}
                  value={pendingSecret}
                  disabled={!draft.currentName}
                  onChange={(event) => setPendingSecret(event.target.value)}
                />
                <Button variant="secondary" onClick={saveSecret} disabled={!draft.currentName || !pendingSecret.trim()}>
                  Save Secret
                </Button>
                <Button variant="outline" onClick={clearSecret} disabled={!draft.currentName || !selectedSummary?.hasSecret}>
                  Clear Secret
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No Profile Selected</CardTitle>
            <CardDescription>Create a profile to connect the UI to a configured model.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="gap-2" onClick={startCreateProfile}>
              <Plus size={16} />
              Add First Profile
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
