import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSaasMakerStatus,
  isTauriAvailable,
  listSaasMakerProjects,
  type SaasMakerProject,
  type SaasMakerStatus,
  setSaasMakerConfig,
} from "@/lib/tauri-ipc";

export default function SaasMakerConfigPanel() {
  const [status, setStatus] = useState<SaasMakerStatus | null>(null);
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [projects, setProjects] = useState<SaasMakerProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setProjectsLoading(true);
    try {
      const rows = await listSaasMakerProjects();
      setProjects(rows);
    } catch {
      // Silent: empty dropdown falls back to free-form slug input.
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const s = await getSaasMakerStatus();
      setStatus(s);
      setBaseUrl(s.base_url);
      setProjectSlug(s.project_slug ?? "");
      if (s.configured) await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadProjects]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Configuration requires the desktop app.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const s = await setSaasMakerConfig({
        token: token || null,
        base_url: baseUrl || null,
        project_slug: projectSlug || null,
      });
      setStatus(s);
      setToken("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [token, baseUrl, projectSlug]);

  const tokenFromEnv = status?.token_source === "env";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-slate-400">
          Connect to the fleet task DB at{" "}
          <span className="font-mono">api.sassmaker.com</span>. CodeVetter and
          the cockpit read/write the same projects and tasks. Mint an{" "}
          <span className="font-mono">sm_*</span> CLI token in the cockpit and
          paste it below — or set{" "}
          <span className="font-mono">SAASMAKER_SESSION_TOKEN</span> in your
          shell.
        </p>
        {status && (
          <Badge
            variant="outline"
            className={
              status.configured
                ? "border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-200"
                : "border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-200"
            }
          >
            {status.configured ? (
              <>
                <CheckCircle2 size={10} className="mr-1 inline" /> Connected ·{" "}
                {status.token_source}
              </>
            ) : (
              <>
                <AlertTriangle size={10} className="mr-1 inline" /> Not configured
              </>
            )}
          </Badge>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="cv-label mb-1 block">Session token</label>
          <Input
            type="password"
            value={token}
            placeholder={
              tokenFromEnv
                ? "Overridden by SAASMAKER_SESSION_TOKEN env"
                : status?.configured
                  ? "(stored — replace to update)"
                  : "Bearer token from SaaS Maker"
            }
            onChange={(e) => setToken(e.target.value)}
            disabled={tokenFromEnv}
            className="font-mono text-xs"
          />
          {tokenFromEnv && (
            <p className="mt-1 text-[10px] text-slate-500">
              Env var wins over stored values. Unset it to edit here.
            </p>
          )}
        </div>

        <div>
          <label className="cv-label mb-1 block">Base URL</label>
          <Input
            value={baseUrl}
            placeholder="https://api.saasmaker.com"
            onChange={(e) => setBaseUrl(e.target.value)}
            className="font-mono text-xs"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="cv-label">Project slug</label>
            <button
              type="button"
              onClick={loadProjects}
              disabled={projectsLoading || !status?.configured}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-[var(--cv-accent)] disabled:opacity-40"
            >
              {projectsLoading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RefreshCw size={10} />
              )}
              fetch from fleet
            </button>
          </div>
          {projects.length > 0 ? (
            <select
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
              className="w-full rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1.5 font-mono text-xs text-slate-200"
            >
              <option value="">(none)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.slug ?? ""}>
                  {p.name}
                  {p.slug ? ` — ${p.slug}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={projectSlug}
              placeholder="codevetter"
              onChange={(e) => setProjectSlug(e.target.value)}
              className="font-mono text-xs"
            />
          )}
          <p className="mt-1 text-[10px] text-slate-500">
            Default project slug used when pulling tasks and pushing findings.
            Once connected, the dropdown lists every fleet project you own.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="font-mono">{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <Loader2 size={12} className="mr-1.5 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save size={12} className="mr-1.5" />
              Save
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
