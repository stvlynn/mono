import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface GeneralConfig {
  theme: string
  heartbeatInterval: number
  telemetry: boolean
}

interface GeneralSectionProps {
  config: GeneralConfig
  onChange: (config: Partial<GeneralConfig>) => void
}

export function GeneralSection({ config, onChange }: GeneralSectionProps) {
  const themes = [
    { id: 'light', label: 'Light', className: 'bg-background' },
    { id: 'dark', label: 'Dark', className: 'bg-slate-900 text-white hover:bg-slate-800' },
    { id: 'system', label: 'System', className: '' },
  ] as const

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application Settings</CardTitle>
        <CardDescription>System-wide configurations and appearance.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label id="ui-theme-label">UI Theme</Label>
          <div
            role="group"
            aria-labelledby="ui-theme-label"
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {themes.map((theme) => (
              <Button 
                key={theme.id}
                type="button"
                aria-pressed={config.theme === theme.id}
                variant={config.theme === theme.id ? "secondary" : "outline"} 
                size="sm" 
                className={theme.className}
                onClick={() => onChange({ theme: theme.id })}
              >
                {theme.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="heartbeat-interval">Heartbeat Interval (ms)</Label>
          <Input 
            id="heartbeat-interval"
            type="number" 
            value={config.heartbeatInterval} 
            step="1000" 
            onChange={(e) => onChange({ heartbeatInterval: Number(e.target.value) || 0 })}
            className="max-w-[200px]" 
          />
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label htmlFor="anonymous-telemetry">Anonymous Telemetry</Label>
            <p className="text-xs text-muted-foreground">Help improve Mono by sending usage statistics.</p>
          </div>
          <Switch 
            id="anonymous-telemetry"
            checked={config.telemetry} 
            onCheckedChange={(checked) => onChange({ telemetry: checked })}
          />
        </div>
      </CardContent>
    </Card>
  )
}
