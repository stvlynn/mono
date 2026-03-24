import { AlertTriangle, FileJson } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

interface RawConfigSectionProps {
  value: string
  configPath: string
  error: string | null
  onChange: (value: string) => void
  onReset: () => void
  onSave: () => void
  saving: boolean
}

export function RawConfigSection({
  value,
  configPath,
  error,
  onChange,
  onReset,
  onSave,
  saving,
}: RawConfigSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileJson size={18} />
          Raw Global Config
        </CardTitle>
        <CardDescription>
          Edit the materialized global config snapshot at <span className="font-mono">{configPath}</span>.
          Sensitive values remain redacted unless replaced through their dedicated controls.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <Textarea
          value={value}
          className="min-h-[560px] font-mono text-xs leading-5"
          onChange={(event) => onChange(event.target.value)}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onReset}>Reset To Disk</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save Raw Config"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
