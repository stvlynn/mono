import { Database, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { MemoryConfig, MemoryStatus } from "@/types"

interface MemorySectionProps {
  config: MemoryConfig
  status: MemoryStatus | null
  onChange: (config: MemoryConfig) => void
}

const selectClassName =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

export function MemorySection({ config, status, onChange }: MemorySectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Execution Memory</CardTitle>
          <CardDescription>Short-term recall, storage layout, and retrieval backend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="memory-enabled">Memory Enabled</Label>
                <p className="text-xs text-muted-foreground">Persist execution memory records after each task.</p>
              </div>
              <Switch
                id="memory-enabled"
                checked={config.enabled}
                onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="memory-auto-inject">Auto Inject</Label>
                <p className="text-xs text-muted-foreground">Automatically retrieve and inject memory into prompts.</p>
              </div>
              <Switch
                id="memory-auto-inject"
                checked={config.autoInject}
                onCheckedChange={(checked) => onChange({ ...config, autoInject: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="memory-fallback-local">Fallback To Local</Label>
                <p className="text-xs text-muted-foreground">Use local recall when remote retrieval backends fail.</p>
              </div>
              <Switch
                id="memory-fallback-local"
                checked={config.fallbackToLocalOnFailure}
                onCheckedChange={(checked) => onChange({ ...config, fallbackToLocalOnFailure: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-backend">Retrieval Backend</Label>
              <select
                id="memory-backend"
                className={selectClassName}
                value={config.retrievalBackend}
                onChange={(event) => onChange({ ...config, retrievalBackend: event.target.value as MemoryConfig["retrievalBackend"] })}
              >
                <option value="local">Local</option>
                <option value="openviking">OpenViking</option>
                <option value="seekdb">SeekDB</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="memory-store-path">Store Path</Label>
              <Input
                id="memory-store-path"
                value={config.storePath}
                onChange={(event) => onChange({ ...config, storePath: event.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-latest-roots">Latest Roots</Label>
              <Input
                id="memory-latest-roots"
                type="number"
                min="0"
                value={config.latestRoots}
                onChange={(event) => onChange({ ...config, latestRoots: Number(event.target.value) || 0 })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-keyword-limit">Keyword Search Limit</Label>
              <Input
                id="memory-keyword-limit"
                type="number"
                min="0"
                value={config.keywordSearchLimit}
                onChange={(event) => onChange({ ...config, keywordSearchLimit: Number(event.target.value) || 0 })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-raw-pair-cap">Raw Pair Cap</Label>
              <Input
                id="memory-raw-pair-cap"
                type="number"
                min="0"
                value={config.rawPairCapNum}
                onChange={(event) => onChange({ ...config, rawPairCapNum: Number(event.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="memory-compacted-level">Compacted Levels</Label>
              <Input
                id="memory-compacted-level"
                type="number"
                min="0"
                value={config.compactedLevelNum}
                onChange={(event) => onChange({ ...config, compactedLevelNum: Number(event.target.value) || 0 })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-raw-pair-level">Raw Pair Levels</Label>
              <Input
                id="memory-raw-pair-level"
                type="number"
                min="0"
                value={config.rawPairLevelNum}
                onChange={(event) => onChange({ ...config, rawPairLevelNum: Number(event.target.value) || 0 })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-compacted-cap">Compacted Cap</Label>
              <Input
                id="memory-compacted-cap"
                type="number"
                min="0"
                value={config.compactedCapNum}
                onChange={(event) => onChange({ ...config, compactedCapNum: Number(event.target.value) || 0 })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OpenViking</CardTitle>
          <CardDescription>Remote retrieval and optional shadow export configuration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="openviking-enabled">Enabled</Label>
                <p className="text-xs text-muted-foreground">Use OpenViking as a retrieval backend.</p>
              </div>
              <Switch
                id="openviking-enabled"
                checked={config.openViking.enabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    openViking: {
                      ...config.openViking,
                      enabled: checked,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="openviking-session-search">Use Session Search</Label>
                <p className="text-xs text-muted-foreground">Prefer session search APIs for retrieval.</p>
              </div>
              <Switch
                id="openviking-session-search"
                checked={config.openViking.useSessionSearch}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    openViking: {
                      ...config.openViking,
                      useSessionSearch: checked,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="openviking-shadow-export">Shadow Export</Label>
                <p className="text-xs text-muted-foreground">Mirror execution memory records asynchronously.</p>
              </div>
              <Switch
                id="openviking-shadow-export"
                checked={config.openViking.shadowExport}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    openViking: {
                      ...config.openViking,
                      shadowExport: checked,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openviking-timeout">Timeout (ms)</Label>
              <Input
                id="openviking-timeout"
                type="number"
                min="0"
                value={config.openViking.timeoutMs}
                onChange={(event) =>
                  onChange({
                    ...config,
                    openViking: {
                      ...config.openViking,
                      timeoutMs: Number(event.target.value) || 0,
                    },
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="openviking-url">URL</Label>
              <Input
                id="openviking-url"
                value={config.openViking.url ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    openViking: {
                      ...config.openViking,
                      url: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openviking-agent-id">Agent ID</Label>
              <Input
                id="openviking-agent-id"
                value={config.openViking.agentId ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    openViking: {
                      ...config.openViking,
                      agentId: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openviking-api-key-env">API Key Env</Label>
              <Input
                id="openviking-api-key-env"
                value={config.openViking.apiKeyEnv ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    openViking: {
                      ...config.openViking,
                      apiKeyEnv: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="openviking-target-uri">Target URI</Label>
              <Input
                id="openviking-target-uri"
                value={config.openViking.targetUri}
                onChange={(event) =>
                  onChange({
                    ...config,
                    openViking: {
                      ...config.openViking,
                      targetUri: event.target.value,
                    },
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SeekDB</CardTitle>
          <CardDescription>MySQL or embedded retrieval configuration for execution memory.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="seekdb-enabled">Enabled</Label>
                <p className="text-xs text-muted-foreground">Allow SeekDB-backed memory retrieval.</p>
              </div>
              <Switch
                id="seekdb-enabled"
                checked={config.seekDb.enabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      enabled: checked,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-mode">Mode</Label>
              <select
                id="seekdb-mode"
                className={selectClassName}
                value={config.seekDb.mode}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      mode: event.target.value as MemoryConfig["seekDb"]["mode"],
                    },
                  })
                }
              >
                <option value="mysql">MySQL</option>
                <option value="python-embedded">Python Embedded</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-timeout">Timeout (ms)</Label>
              <Input
                id="seekdb-timeout"
                type="number"
                min="0"
                value={config.seekDb.timeoutMs}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      timeoutMs: Number(event.target.value) || 0,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="seekdb-mirror-sessions">Mirror Sessions Only</Label>
                <p className="text-xs text-muted-foreground">Restrict mirror operations to session-derived records.</p>
              </div>
              <Switch
                id="seekdb-mirror-sessions"
                checked={config.seekDb.mirrorSessionsOnly}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      mirrorSessionsOnly: checked,
                    },
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="seekdb-mysql-binary">MySQL Binary</Label>
              <Input
                id="seekdb-mysql-binary"
                value={config.seekDb.mysqlBinary}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      mysqlBinary: event.target.value,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-host">Host</Label>
              <Input
                id="seekdb-host"
                value={config.seekDb.host ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      host: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-port">Port</Label>
              <Input
                id="seekdb-port"
                type="number"
                min="0"
                value={config.seekDb.port ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      port: event.target.value ? Number(event.target.value) : undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-database">Database</Label>
              <Input
                id="seekdb-database"
                value={config.seekDb.database ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      database: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-user">User</Label>
              <Input
                id="seekdb-user"
                value={config.seekDb.user ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      user: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-password-env">Password Env</Label>
              <Input
                id="seekdb-password-env"
                value={config.seekDb.passwordEnv ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      passwordEnv: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-python-exec">Python Executable</Label>
              <Input
                id="seekdb-python-exec"
                value={config.seekDb.pythonExecutable ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      pythonExecutable: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-python-module">Python Module</Label>
              <Input
                id="seekdb-python-module"
                value={config.seekDb.pythonModule ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      pythonModule: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seekdb-embedded-path">Embedded Path</Label>
              <Input
                id="seekdb-embedded-path"
                value={config.seekDb.embeddedPath ?? ""}
                onChange={(event) =>
                  onChange({
                    ...config,
                    seekDb: {
                      ...config.seekDb,
                      embeddedPath: event.target.value || undefined,
                    },
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Structured Memory (V2)</CardTitle>
          <CardDescription>Local-first long-term memory settings and promotion/decay behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="memory-v2-enabled">Enabled</Label>
                <p className="text-xs text-muted-foreground">Turn on structured memory capture and retrieval.</p>
              </div>
              <Switch
                id="memory-v2-enabled"
                checked={config.v2.enabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      enabled: checked,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="memory-v2-inject">Inject Into Context</Label>
                <p className="text-xs text-muted-foreground">Render structured-memory packages into prompts.</p>
              </div>
              <Switch
                id="memory-v2-inject"
                checked={config.v2.injectIntoContext}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      injectIntoContext: checked,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="memory-v2-inference">Enable Inference</Label>
                <p className="text-xs text-muted-foreground">Allow inference promotion from repeated observations.</p>
              </div>
              <Switch
                id="memory-v2-inference"
                checked={config.v2.enableInference}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      enableInference: checked,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-v2-openviking-sync">OpenViking Sync</Label>
              <select
                id="memory-v2-openviking-sync"
                className={selectClassName}
                value={config.v2.openVikingSync}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      openVikingSync: event.target.value as MemoryConfig["v2"]["openVikingSync"],
                    },
                  })
                }
              >
                <option value="off">Off</option>
                <option value="async">Async</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="memory-v2-store-path">Store Path</Label>
              <Input
                id="memory-v2-store-path"
                value={config.v2.storePath}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      storePath: event.target.value,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-v2-primary-entity">Primary Entity ID</Label>
              <Input
                id="memory-v2-primary-entity"
                value={config.v2.primaryEntityId}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      primaryEntityId: event.target.value,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-v2-max-evidence">Max Evidence / Package</Label>
              <Input
                id="memory-v2-max-evidence"
                type="number"
                min="0"
                value={config.v2.maxEvidencePerPackage}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      maxEvidencePerPackage: Number(event.target.value) || 0,
                    },
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="memory-v2-explicit-days">Explicit Preference Days</Label>
              <Input
                id="memory-v2-explicit-days"
                type="number"
                min="0"
                value={config.v2.decay.explicitPreferenceDays}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      decay: {
                        ...config.v2.decay,
                        explicitPreferenceDays: Number(event.target.value) || 0,
                      },
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-v2-inferred-days">Inferred Trait Days</Label>
              <Input
                id="memory-v2-inferred-days"
                type="number"
                min="0"
                value={config.v2.decay.inferredTraitDays}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      decay: {
                        ...config.v2.decay,
                        inferredTraitDays: Number(event.target.value) || 0,
                      },
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-v2-relationship-days">Relationship Signal Days</Label>
              <Input
                id="memory-v2-relationship-days"
                type="number"
                min="0"
                value={config.v2.decay.relationshipSignalDays}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      decay: {
                        ...config.v2.decay,
                        relationshipSignalDays: Number(event.target.value) || 0,
                      },
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-v2-min-pattern">Min Pattern Occurrences</Label>
              <Input
                id="memory-v2-min-pattern"
                type="number"
                min="0"
                value={config.v2.promotion.minPatternOccurrences}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      promotion: {
                        ...config.v2.promotion,
                        minPatternOccurrences: Number(event.target.value) || 0,
                      },
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-v2-stable-pref">Stable Preference Occurrences</Label>
              <Input
                id="memory-v2-stable-pref"
                type="number"
                min="0"
                value={config.v2.promotion.stablePreferenceOccurrences}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      promotion: {
                        ...config.v2.promotion,
                        stablePreferenceOccurrences: Number(event.target.value) || 0,
                      },
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memory-v2-stable-inference">Stable Inference Days</Label>
              <Input
                id="memory-v2-stable-inference"
                type="number"
                min="0"
                value={config.v2.promotion.stableInferenceDays}
                onChange={(event) =>
                  onChange({
                    ...config,
                    v2: {
                      ...config.v2,
                      promotion: {
                        ...config.v2.promotion,
                        stableInferenceDays: Number(event.target.value) || 0,
                      },
                    },
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database size={18} />
            Runtime Snapshot
          </CardTitle>
          <CardDescription>Current values reported by the CLI memory status use case.</CardDescription>
        </CardHeader>
        <CardContent>
          {status ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border bg-background p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Backend</p>
                <p className="mt-2 text-sm font-medium">{status.retrievalBackend}</p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Records</p>
                <p className="mt-2 text-sm font-medium">{status.records}</p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Structured Conflicts</p>
                <p className="mt-2 text-sm font-medium">{status.v2Conflicts}</p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">OpenViking</p>
                <p className="mt-2 text-sm font-medium break-all">{status.openViking}</p>
              </div>
              <div className="rounded-lg border bg-background p-4 md:col-span-2 xl:col-span-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Queues</p>
                <p className="mt-2 text-sm text-foreground">
                  Pending {status.v2PendingQueue} · Autonomy {status.v2AutonomyQueue} · Feedback {status.v2FeedbackSignals} · Heartbeat {status.v2HeartbeatDecisions}/{status.v2HeartbeatReplies}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border bg-background p-4 text-sm text-muted-foreground">
              <Info size={18} className="mt-0.5 shrink-0" />
              <p>Loading runtime memory status…</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
