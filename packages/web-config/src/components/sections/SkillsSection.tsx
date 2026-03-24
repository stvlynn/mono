import { useMemo, useState } from "react"
import { Download, Search, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { SkillRecord, SkillSearchResult } from "@/types"

interface SkillsSectionProps {
  skills: SkillRecord[]
  loading: boolean
  onSearchSkills: (query: string) => Promise<SkillSearchResult[]>
  onInstallSkill: (source: string) => Promise<void>
}

export function SkillsSection({ skills, loading, onSearchSkills, onInstallSkill }: SkillsSectionProps) {
  const [query, setQuery] = useState("")
  const [remoteResults, setRemoteResults] = useState<SkillSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [installingSource, setInstallingSource] = useState<string | null>(null)

  const groupedSkills = useMemo(() => {
    return [...skills].sort((left, right) => left.name.localeCompare(right.name))
  }, [skills])

  const search = async () => {
    if (!query.trim()) {
      setRemoteResults([])
      return
    }

    setSearching(true)
    try {
      setRemoteResults(await onSearchSkills(query))
    } finally {
      setSearching(false)
    }
  }

  const install = async (source: string) => {
    setInstallingSource(source)
    try {
      await onInstallSkill(source)
    } finally {
      setInstallingSource(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Skill Registry</CardTitle>
          <CardDescription>Inspect installed builtin/global/project skills and add remote skills.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex-1">
              <label htmlFor="skills-search" className="sr-only">Search remote skills</label>
              <Input
                id="skills-search"
                value={query}
                placeholder="Search the remote skills registry"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button className="gap-2 md:self-start" onClick={search} disabled={searching}>
              <Search size={16} />
              {searching ? "Searching…" : "Search Remote"}
            </Button>
          </div>

          {remoteResults.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {remoteResults.map((result) => (
                <Card key={result.id} className="border-dashed">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{result.name}</CardTitle>
                    <CardDescription>{result.source}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    <p>{result.installs.toLocaleString()} installs</p>
                    <p className="break-all">{result.installSource}</p>
                    <a className="text-primary underline-offset-4 hover:underline" href={result.url} target="_blank" rel="noreferrer">
                      {result.url}
                    </a>
                  </CardContent>
                  <CardFooter>
                    <Button
                      className="ml-auto gap-2"
                      variant="secondary"
                      onClick={() => install(result.installSource)}
                      disabled={installingSource === result.installSource}
                    >
                      <Download size={16} />
                      {installingSource === result.installSource ? "Installing…" : "Install"}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {groupedSkills.map((skill) => (
          <Card key={`${skill.origin}-${skill.location}`}>
            <CardHeader className="pb-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Zap size={18} />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-base">{skill.name}</CardTitle>
                  <CardDescription>
                    {skill.origin} · <span className="font-mono text-[11px]">{skill.location}</span>
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{skill.description || "No description provided."}</p>
              <div className="rounded-lg border bg-muted/30 p-3">
                <pre className="line-clamp-6 whitespace-pre-wrap text-xs leading-5 text-foreground">{skill.content}</pre>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && groupedSkills.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No Skills Found</CardTitle>
            <CardDescription>No builtin, global, or project skills are currently available.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  )
}
