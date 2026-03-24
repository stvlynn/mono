import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { SettingsConfig } from "@/types"

interface SettingsSectionProps {
  config: SettingsConfig
  onChange: (config: SettingsConfig) => void
}

const selectClassName =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

function updateSafety<K extends keyof SettingsConfig["safety"]>(
  config: SettingsConfig,
  key: K,
  value: SettingsConfig["safety"][K]
): SettingsConfig {
  return {
    ...config,
    safety: {
      ...config.safety,
      [key]: value,
    },
  }
}

function updateAutonomy<K extends keyof SettingsConfig["autonomy"]>(
  config: SettingsConfig,
  key: K,
  value: SettingsConfig["autonomy"][K]
): SettingsConfig {
  return {
    ...config,
    autonomy: {
      ...config.autonomy,
      [key]: value,
    },
  }
}

function updateTui<K extends keyof SettingsConfig["tui"]>(
  config: SettingsConfig,
  key: K,
  value: SettingsConfig["tui"][K]
): SettingsConfig {
  return {
    ...config,
    tui: {
      ...config.tui,
      [key]: value,
    },
  }
}

export function SettingsSection({ config, onChange }: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Safety Defaults</CardTitle>
          <CardDescription>Default execution rules for new runs.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="settings-approval-mode">Approval Mode</Label>
            <select
              id="settings-approval-mode"
              className={selectClassName}
              value={config.safety.approvalMode}
              onChange={(event) => onChange(updateSafety(config, "approvalMode", event.target.value as SettingsConfig["approvalMode"]))}
            >
              <option value="default">Default</option>
              <option value="always-ask">Always Ask</option>
              <option value="auto-approve-safe">Auto-approve Safe</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-approval-policy">Approval Policy</Label>
            <select
              id="settings-approval-policy"
              className={selectClassName}
              value={config.safety.approvalPolicy}
              onChange={(event) => onChange(updateSafety(config, "approvalPolicy", event.target.value as SettingsConfig["approvalPolicy"]))}
            >
              <option value="on-request">On request</option>
              <option value="never">Never</option>
              <option value="auto-approve">Auto-approve</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-sandbox-mode">Sandbox Mode</Label>
            <select
              id="settings-sandbox-mode"
              className={selectClassName}
              value={config.safety.sandboxMode}
              onChange={(event) => onChange(updateSafety(config, "sandboxMode", event.target.value as SettingsConfig["sandboxMode"]))}
            >
              <option value="read-only">Read-only</option>
              <option value="danger-full-access">Danger full access</option>
              <option value="workspace-write" disabled>Workspace write (not implemented)</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-sensitive-action-mode">Sensitive Action Mode</Label>
            <select
              id="settings-sensitive-action-mode"
              className={selectClassName}
              value={config.safety.sensitiveActionMode}
              onChange={(event) => onChange(updateSafety(config, "sensitiveActionMode", event.target.value as SettingsConfig["sensitiveActionMode"]))}
            >
              <option value="allow_all">Allow all</option>
              <option value="blacklist">Blacklist</option>
              <option value="strict">Strict</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Autonomy</CardTitle>
          <CardDescription>Background behavior and task pacing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="autonomy-enabled">Enable autonomy</Label>
              <p className="text-xs text-muted-foreground">Allow the runtime to create heartbeat-driven follow-up work.</p>
            </div>
            <Switch
              id="autonomy-enabled"
              checked={config.autonomy.enabled}
              onCheckedChange={(checked) => onChange(updateAutonomy(config, "enabled", checked))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="autonomy-heartbeat">Heartbeat Interval (ms)</Label>
              <Input
                id="autonomy-heartbeat"
                type="number"
                min="1000"
                step="1000"
                value={config.autonomy.heartbeatIntervalMs}
                onChange={(event) => onChange(updateAutonomy(config, "heartbeatIntervalMs", Number(event.target.value) || 0))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="autonomy-max-tasks">Max Autonomous Tasks / Hour</Label>
              <Input
                id="autonomy-max-tasks"
                type="number"
                min="0"
                value={config.autonomy.maxAutonomousTasksPerHour}
                onChange={(event) => onChange(updateAutonomy(config, "maxAutonomousTasksPerHour", Number(event.target.value) || 0))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="autonomy-broad-execution">Allow broad execution</Label>
              <p className="text-xs text-muted-foreground">Permit wider task exploration without narrowing the scope first.</p>
            </div>
            <Switch
              id="autonomy-broad-execution"
              checked={config.autonomy.allowBroadExecution}
              onCheckedChange={(checked) => onChange(updateAutonomy(config, "allowBroadExecution", checked))}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="autonomy-isolated-session">Isolated Session</Label>
              <p className="text-xs text-muted-foreground">Run autonomy work in a separate session when enabled.</p>
            </div>
            <Switch
              id="autonomy-isolated-session"
              checked={config.autonomy.isolatedSession}
              onCheckedChange={(checked) => onChange(updateAutonomy(config, "isolatedSession", checked))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Theme and terminal presentation defaults.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="appearance-theme">Theme</Label>
            <select
              id="appearance-theme"
              className={selectClassName}
              value={config.appearance.theme}
              onChange={(event) =>
                onChange({
                  ...config,
                  appearance: {
                    ...config.appearance,
                    theme: event.target.value,
                  },
                })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="tui-clean-ui">Clean UI Details</Label>
                <p className="text-xs text-muted-foreground">Show simplified terminal detail blocks.</p>
              </div>
              <Switch
                id="tui-clean-ui"
                checked={config.tui.cleanUiDetailsVisible}
                onCheckedChange={(checked) => onChange(updateTui(config, "cleanUiDetailsVisible", checked))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="tui-footer-visible">Footer Visible</Label>
                <p className="text-xs text-muted-foreground">Display the command/help footer in the TUI.</p>
              </div>
              <Switch
                id="tui-footer-visible"
                checked={config.tui.footerVisible}
                onCheckedChange={(checked) => onChange(updateTui(config, "footerVisible", checked))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="tui-markdown">Assistant Markdown</Label>
                <p className="text-xs text-muted-foreground">Render markdown formatting inside the TUI.</p>
              </div>
              <Switch
                id="tui-markdown"
                checked={config.tui.assistantMarkdownEnabled}
                onCheckedChange={(checked) => onChange(updateTui(config, "assistantMarkdownEnabled", checked))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="tui-thinking">Thinking Visible</Label>
                <p className="text-xs text-muted-foreground">Show hidden reasoning blocks when available.</p>
              </div>
              <Switch
                id="tui-thinking"
                checked={config.tui.thinkingVisible}
                onCheckedChange={(checked) => onChange(updateTui(config, "thinkingVisible", checked))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="tui-tools">Tool Details Visible</Label>
                <p className="text-xs text-muted-foreground">Keep tool-call metadata expanded in terminal output.</p>
              </div>
              <Switch
                id="tui-tools"
                checked={config.tui.toolDetailsVisible}
                onCheckedChange={(checked) => onChange(updateTui(config, "toolDetailsVisible", checked))}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="tui-shortcuts">Shortcuts Hint</Label>
                <p className="text-xs text-muted-foreground">Show shortcut hints in the TUI footer.</p>
              </div>
              <Switch
                id="tui-shortcuts"
                checked={config.tui.shortcutsHint}
                onCheckedChange={(checked) => onChange(updateTui(config, "shortcutsHint", checked))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tui-alternate-buffer">Alternate Buffer</Label>
            <select
              id="tui-alternate-buffer"
              className={selectClassName}
              value={String(config.tui.alternateBuffer)}
              onChange={(event) => {
                const value = event.target.value
                onChange(updateTui(config, "alternateBuffer", value === "true" ? true : value === "false" ? false : "auto"))
              }}
            >
              <option value="auto">Auto</option>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
