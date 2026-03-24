import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'

interface SafetyConfig {
  approvalPolicy: string
  sandboxMode: boolean
  maxTasksPerHour: number
}

interface SafetySectionProps {
  config: SafetyConfig
  onChange: (config: Partial<SafetyConfig>) => void
}

export function SafetySection({ config, onChange }: SafetySectionProps) {
  const policies = [
    { id: 'on-request', title: 'Always Ask (Recommended)', desc: 'Prompt for permission before every tool call.' },
    { id: 'safe-only', title: 'Auto-approve Safe Tools', desc: 'Only ask for file system or network operations.' },
    { id: 'never', title: 'Fully Autonomous', desc: 'Proceed without asking (Use with caution).', risky: true },
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Safety Policy</CardTitle>
          <CardDescription>Control how the agent executes critical or risky commands.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Tool Approval Policy</legend>
            <div className="grid gap-2" role="radiogroup" aria-label="Tool Approval Policy">
              {policies.map((policy) => {
                const inputId = `approval-policy-${policy.id}`
                const descriptionId = `${inputId}-description`

                return (
                  <div
                    key={policy.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${policy.risky ? 'opacity-80' : ''}`}
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name="approval-policy"
                      className="mt-1 h-4 w-4"
                      aria-describedby={descriptionId}
                      checked={config.approvalPolicy === policy.id}
                      onChange={() => onChange({ approvalPolicy: policy.id })}
                    />
                    <label htmlFor={inputId} className="flex-1 cursor-pointer">
                      <p className={`text-sm font-medium ${policy.risky ? 'text-destructive' : 'text-foreground'}`}>
                        {policy.title}
                      </p>
                      <p id={descriptionId} className="text-xs text-muted-foreground">{policy.desc}</p>
                    </label>
                  </div>
                )
              })}
            </div>
          </fieldset>

          <div className="flex items-center justify-between py-2 border-t pt-6">
            <div className="space-y-0.5">
              <Label htmlFor="docker-sandbox-mode">Docker Sandbox Mode</Label>
              <p className="text-xs text-muted-foreground">Execute shell commands within a secure container.</p>
            </div>
            <Switch 
              id="docker-sandbox-mode"
              checked={config.sandboxMode} 
              onCheckedChange={(checked) => onChange({ sandboxMode: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="max-autonomous-tasks">Max Autonomous Tasks (per hour)</Label>
            <Input 
              id="max-autonomous-tasks"
              type="number" 
              min="0"
              value={config.maxTasksPerHour} 
              onChange={(e) => onChange({ maxTasksPerHour: Number(e.target.value) || 0 })}
              className="max-w-[120px]" 
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
