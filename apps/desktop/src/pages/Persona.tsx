import { AlertTriangle, Loader2, Sparkles, Users } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  generatePersonas,
  isTauriAvailable,
  type PersonaReport,
} from "@/lib/tauri-ipc";

export default function Persona() {
  const [repo, setRepo] = useState("");
  const [sampleSize, setSampleSize] = useState(50);
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [report, setReport] = useState<PersonaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Persona generation requires the desktop app.");
      return;
    }
    if (!repo.trim() || !repo.includes("/")) {
      setError("Enter owner/repo, e.g. sarthak-fleet/CodeVetter");
      return;
    }
    setError(null);
    setLoading(true);
    setReport(null);
    try {
      const r = await generatePersonas({
        repo: repo.trim(),
        sample_size: sampleSize,
        provider,
      });
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [repo, sampleSize, provider]);

  return (
    <div className="mx-auto max-w-5xl px-6 pb-24 pt-20">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Users size={22} className="text-[var(--cv-accent)]" />
          <h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
          <Badge
            variant="outline"
            className="border-cyan-500/40 bg-cyan-500/10 text-[10px] uppercase tracking-wider text-[var(--cv-accent)]"
          >
            Beta
          </Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
          Who actually shows up for this repo. Samples stargazers + issue
          authors via GitHub, fetches their public profiles, and asks the
          LLM to cluster them into 3–5 user archetypes with signals and
          jobs-to-be-done.
        </p>
      </header>

      <Card className="mb-4 border-[var(--cv-line)] bg-[var(--bg-surface)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configure</CardTitle>
          <CardDescription className="text-xs">
            Uses your stored <span className="font-mono">github_token</span>{" "}
            (Settings → Integrations → GitHub) when set, so rate-limited 60
            req/h jumps to authenticated 5000.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="cv-label mb-1 block">GitHub repo</label>
            <Input
              value={repo}
              placeholder="sarthak-fleet/CodeVetter"
              onChange={(e) => setRepo(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-[var(--text-secondary)]">Sample size</span>
              <select
                value={sampleSize}
                onChange={(e) => setSampleSize(Number(e.target.value))}
                className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1 font-mono text-[10px]"
              >
                {[25, 50, 100, 150, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[var(--text-secondary)]">Brain</span>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as "claude" | "codex")}
                className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1 font-mono text-[10px]"
              >
                <option value="claude">claude</option>
                <option value="codex">codex</option>
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleRun}
              disabled={loading}
              className="ml-auto"
            >
              {loading ? (
                <Loader2 size={12} className="mr-1.5 animate-spin" />
              ) : (
                <Sparkles size={12} className="mr-1.5" />
              )}
              Generate
            </Button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span className="font-mono">{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {report && <PersonaReportView report={report} />}
    </div>
  );
}

function PersonaReportView({ report }: { report: PersonaReport }) {
  return (
    <div className="space-y-4">
      <Card className="border-[var(--cv-line)] bg-[var(--bg-surface)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Audience summary</CardTitle>
          <CardDescription className="text-xs">
            <span className="font-mono">{report.repo}</span> · sample of{" "}
            {report.sample_size} profiles ({report.stargazer_count} stargazers,{" "}
            {report.issue_author_count} issue authors) · {(report.took_ms / 1000).toFixed(1)}s
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-primary)]">{report.summary}</p>
          {report.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10px] text-amber-300/80">
              {report.warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {report.archetypes.map((a, i) => (
          <Card
            key={i}
            className="border-[var(--cv-line)] bg-[var(--bg-surface)]"
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">{a.name}</CardTitle>
                <Badge
                  variant="outline"
                  className="border-cyan-500/40 bg-cyan-500/10 text-[10px] text-[var(--cv-accent)]"
                >
                  {a.population_pct.toFixed(0)}%
                </Badge>
              </div>
              <CardDescription className="text-xs text-[var(--text-primary)]">
                {a.one_liner}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {a.representative_handles.length > 0 && (
                <div>
                  <div className="cv-label mb-1">Representative handles</div>
                  <div className="flex flex-wrap gap-1">
                    {a.representative_handles.slice(0, 6).map((h) => (
                      <a
                        key={h}
                        href={`https://github.com/${h}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-0.5 font-mono text-[10px] text-[var(--cv-accent)] hover:underline"
                      >
                        @{h}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {a.signals.length > 0 && (
                <div>
                  <div className="cv-label mb-1">Signals</div>
                  <ul className="space-y-0.5 text-[var(--text-secondary)]">
                    {a.signals.map((s, j) => (
                      <li key={j}>• {s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {a.jobs_to_be_done.length > 0 && (
                <div>
                  <div className="cv-label mb-1">Jobs to be done</div>
                  <ul className="space-y-0.5 text-[var(--text-primary)]">
                    {a.jobs_to_be_done.map((j, k) => (
                      <li key={k}>• {j}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
