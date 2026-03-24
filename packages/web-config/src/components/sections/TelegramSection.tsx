import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { listToTextarea, parseJsonInput, textareaToList } from "@/lib/config-ui"
import type { TelegramConfig, TelegramStatus } from "@/types"

interface TelegramSectionProps {
  config: TelegramConfig
  status: TelegramStatus | null
  pendingBotToken: string
  onPendingBotTokenChange: (value: string) => void
  onClearBotToken: () => void
  onChange: (config: TelegramConfig) => void
}

const selectClassName =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

export function TelegramSection({
  config,
  status,
  pendingBotToken,
  onPendingBotTokenChange,
  onClearBotToken,
  onChange,
}: TelegramSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Telegram Runtime</CardTitle>
          <CardDescription>Global Telegram control-plane and reply behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="telegram-enabled">Enable Telegram</Label>
              <p className="text-xs text-muted-foreground">Turn on inbound polling and Telegram runtime integration.</p>
            </div>
            <Switch
              id="telegram-enabled"
              checked={config.enabled}
              onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="telegram-bot-token">Bot Token</Label>
              <Input
                id="telegram-bot-token"
                type="password"
                value={pendingBotToken}
                placeholder="Leave blank to keep the current token"
                onChange={(event) => onPendingBotTokenChange(event.target.value)}
              />
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span>{config.botToken ? "A token is currently stored." : "No token stored in config."}</span>
                {config.botToken && (
                  <button
                    type="button"
                    className="cursor-pointer font-medium text-destructive underline-offset-4 hover:underline"
                    onClick={onClearBotToken}
                  >
                    Clear stored token
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="telegram-bot-id">Bot User ID</Label>
              <Input
                id="telegram-bot-id"
                value={config.botId ?? ""}
                onChange={(event) => onChange({ ...config, botId: event.target.value || undefined })}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="telegram-dm-policy">DM Policy</Label>
              <select
                id="telegram-dm-policy"
                className={selectClassName}
                value={config.dmPolicy}
                onChange={(event) => onChange({ ...config, dmPolicy: event.target.value as TelegramConfig["dmPolicy"] })}
              >
                <option value="pairing">Pairing</option>
                <option value="allowlist">Allowlist</option>
                <option value="open">Open</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="telegram-timeout">Polling Timeout (seconds)</Label>
              <Input
                id="telegram-timeout"
                type="number"
                min="1"
                value={config.pollingTimeoutSeconds}
                onChange={(event) => onChange({ ...config, pollingTimeoutSeconds: Number(event.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="telegram-allow-from">Allow From</Label>
              <Textarea
                id="telegram-allow-from"
                value={listToTextarea(config.allowFrom)}
                onChange={(event) => onChange({ ...config, allowFrom: textareaToList(event.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telegram-group-allow-from">Group Allow From</Label>
              <Textarea
                id="telegram-group-allow-from"
                value={listToTextarea(config.groupAllowFrom)}
                onChange={(event) => onChange({ ...config, groupAllowFrom: textareaToList(event.target.value) })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approval And Reply Settings</CardTitle>
          <CardDescription>Chat allowlists, deny lists, and reply formatting defaults.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="telegram-approval-chats">Approval Allow Chats</Label>
              <Textarea
                id="telegram-approval-chats"
                value={listToTextarea(config.approval.allowChats)}
                onChange={(event) =>
                  onChange({
                    ...config,
                    approval: {
                      ...config.approval,
                      allowChats: textareaToList(event.target.value),
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telegram-command-denylist">Command Denylist</Label>
              <Textarea
                id="telegram-command-denylist"
                value={listToTextarea(config.approval.commandDenylist)}
                onChange={(event) =>
                  onChange({
                    ...config,
                    approval: {
                      ...config.approval,
                      commandDenylist: textareaToList(event.target.value),
                    },
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="telegram-multi-message">Multi-message Replies</Label>
                <p className="text-xs text-muted-foreground">Split long replies into multiple Telegram messages.</p>
              </div>
              <Switch
                id="telegram-multi-message"
                checked={config.reply.multiMessage}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    reply: {
                      ...config.reply,
                      multiMessage: checked,
                    },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="telegram-stickers-enabled">Reply Stickers</Label>
                <p className="text-xs text-muted-foreground">Allow the runtime to send configured sticker replies.</p>
              </div>
              <Switch
                id="telegram-stickers-enabled"
                checked={config.reply.stickers.enabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...config,
                    reply: {
                      ...config.reply,
                      stickers: {
                        ...config.reply.stickers,
                        enabled: checked,
                      },
                    },
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="telegram-split-delay">Split Delay (ms)</Label>
              <Input
                id="telegram-split-delay"
                type="number"
                min="0"
                value={config.reply.splitDelayMs}
                onChange={(event) =>
                  onChange({
                    ...config,
                    reply: {
                      ...config.reply,
                      splitDelayMs: Number(event.target.value) || 0,
                    },
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telegram-sticker-store">Sticker Store Path</Label>
              <Input
                id="telegram-sticker-store"
                value={config.reply.stickers.storePath}
                onChange={(event) =>
                  onChange({
                    ...config,
                    reply: {
                      ...config.reply,
                      stickers: {
                        ...config.reply.stickers,
                        storePath: event.target.value,
                      },
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
          <CardTitle>Telegram Actions And Groups</CardTitle>
          <CardDescription>Feature flags for outbound actions and group policy overrides.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {([
              ["send", "Send"],
              ["sticker", "Sticker"],
              ["photo", "Photo"],
              ["document", "Document"],
              ["edit", "Edit"],
              ["delete", "Delete"],
              ["react", "React"],
            ] as const).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <Label htmlFor={`telegram-action-${key}`}>{label}</Label>
                <Switch
                  id={`telegram-action-${key}`}
                  checked={config.actions[key]}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...config,
                      actions: {
                        ...config.actions,
                        [key]: checked,
                      },
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegram-groups">Groups JSON</Label>
            <Textarea
              id="telegram-groups"
              value={JSON.stringify(config.groups, null, 2)}
              onChange={(event) => {
                const parsed = parseJsonInput<Record<string, TelegramConfig["groups"][string]>>(event.target.value)
                if (parsed.value) {
                  onChange({
                    ...config,
                    groups: parsed.value,
                  })
                }
              }}
            />
            <p className="text-xs text-muted-foreground">Use the raw JSON editor for validation details while editing group policies.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runtime Status</CardTitle>
          <CardDescription>Live status from the existing Telegram CLI use case.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {status ? (
            <>
              <p className="text-sm font-medium">{status.title}</p>
              <p className="text-xs text-muted-foreground">{status.status}</p>
              <div className="rounded-lg border bg-muted/30 p-4">
                <pre className="whitespace-pre-wrap text-xs leading-5 text-foreground">{status.lines.join("\n")}</pre>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading Telegram runtime status…</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
