import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { listToTextarea, textareaToList } from "@/lib/config-ui"
import type { ContextConfig } from "@/types"

interface ContextSectionProps {
  config: ContextConfig
  onChange: (config: ContextConfig) => void
}

const selectClassName =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

export function ContextSection({ config, onChange }: ContextSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Context Assembly</CardTitle>
          <CardDescription>Bootstrap documents and prompt injection behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="context-enabled">Enable context assembly</Label>
              <p className="text-xs text-muted-foreground">Include docs, bootstrap files, identity, and memory when composing prompts.</p>
            </div>
            <Switch
              id="context-enabled"
              checked={config.enabled}
              onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="context-timezone">User Timezone</Label>
            <Input
              id="context-timezone"
              value={config.userTimezone}
              onChange={(event) => onChange({ ...config, userTimezone: event.target.value })}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="context-identity-operator">Inject Operator Identity</Label>
                <p className="text-xs text-muted-foreground">Include local operator identity in prompt context.</p>
              </div>
              <Switch
                id="context-identity-operator"
                checked={config.identity.injectOperator}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    identity: {
                      ...config.identity,
                      injectOperator: checked,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="context-identity-project">Inject Project Identity</Label>
                <p className="text-xs text-muted-foreground">Include project identity summaries and durable facts.</p>
              </div>
              <Switch
                id="context-identity-project"
                checked={config.identity.injectProjectIdentity}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    identity: {
                      ...config.identity,
                      injectProjectIdentity: checked,
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
          <CardTitle>Bootstrap Files</CardTitle>
          <CardDescription>Seed files loaded before broader docs traversal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="context-bootstrap-enabled">Enable bootstrap files</Label>
              <p className="text-xs text-muted-foreground">Read selected files early to ground the task.</p>
            </div>
            <Switch
              id="context-bootstrap-enabled"
              checked={config.bootstrap.enabled}
              onCheckedChange={(checked) =>
                onChange({
                  ...config,
                  bootstrap: {
                    ...config.bootstrap,
                    enabled: checked,
                  },
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="context-bootstrap-files">Bootstrap Files</Label>
            <Textarea
              id="context-bootstrap-files"
              value={listToTextarea(config.bootstrap.files)}
              onChange={(event) =>
                onChange({
                  ...config,
                  bootstrap: {
                    ...config.bootstrap,
                    files: textareaToList(event.target.value),
                  },
                })
              }
            />
            <p className="text-xs text-muted-foreground">One file path per line.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="context-bootstrap-max-file">Max Chars / File</Label>
              <Input
                id="context-bootstrap-max-file"
                type="number"
                min="0"
                value={config.bootstrap.maxCharsPerFile}
                onChange={(event) =>
                  onChange({
                    ...config,
                    bootstrap: {
                      ...config.bootstrap,
                      maxCharsPerFile: Number(event.target.value) || 0,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="context-bootstrap-total">Total Max Chars</Label>
              <Input
                id="context-bootstrap-total"
                type="number"
                min="0"
                value={config.bootstrap.totalMaxChars}
                onChange={(event) =>
                  onChange({
                    ...config,
                    bootstrap: {
                      ...config.bootstrap,
                      totalMaxChars: Number(event.target.value) || 0,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="context-bootstrap-warning">Truncation Warning</Label>
              <select
                id="context-bootstrap-warning"
                className={selectClassName}
                value={config.bootstrap.truncationWarning}
                onChange={(event) =>
                  onChange({
                    ...config,
                    bootstrap: {
                      ...config.bootstrap,
                      truncationWarning: event.target.value as ContextConfig["bootstrap"]["truncationWarning"],
                    },
                  })
                }
              >
                <option value="off">Off</option>
                <option value="once">Once</option>
                <option value="always">Always</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Docs And Memory Injection</CardTitle>
          <CardDescription>Control docs discovery and memory injection settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="context-docs-enabled">Enable docs entry paths</Label>
              <p className="text-xs text-muted-foreground">Traverse indexed docs folders when building context.</p>
            </div>
            <Switch
              id="context-docs-enabled"
              checked={config.docs.enabled}
              onCheckedChange={(checked) =>
                onChange({
                  ...config,
                  docs: {
                    ...config.docs,
                    enabled: checked,
                  },
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="context-docs-entry-paths">Docs Entry Paths</Label>
            <Textarea
              id="context-docs-entry-paths"
              value={listToTextarea(config.docs.entryPaths)}
              onChange={(event) =>
                onChange({
                  ...config,
                  docs: {
                    ...config.docs,
                    entryPaths: textareaToList(event.target.value),
                  },
                })
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="context-memory-bootstrap">Inject bootstrap memory file</Label>
                <p className="text-xs text-muted-foreground">Include `.mono/MEMORY.md` style bootstrap memory.</p>
              </div>
              <Switch
                id="context-memory-bootstrap"
                checked={config.memory.injectBootstrapMemoryFile}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    memory: {
                      ...config.memory,
                      injectBootstrapMemoryFile: checked,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="context-memory-retrieved">Inject retrieved memory</Label>
                <p className="text-xs text-muted-foreground">Render recalled execution and structured memory into prompt context.</p>
              </div>
              <Switch
                id="context-memory-retrieved"
                checked={config.memory.injectRetrievedMemory}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    memory: {
                      ...config.memory,
                      injectRetrievedMemory: checked,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="context-reporting-enabled">Enable reporting</Label>
                <p className="text-xs text-muted-foreground">Keep runtime context reporting blocks available.</p>
              </div>
              <Switch
                id="context-reporting-enabled"
                checked={config.reporting.enabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    reporting: {
                      ...config.reporting,
                      enabled: checked,
                    },
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
