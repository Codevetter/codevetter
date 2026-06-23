import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CreditCard,
  Gauge,
  Loader2,
  RefreshCw,
  Save,
  Send,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  type AgentObservability,
  type BillingSnapshot,
  getAgentObservability,
  getBillingConfig,
  getBillingSnapshots,
  getWebhookConfig,
  isTauriAvailable,
  sendWebhookNotification,
  setBillingConfig,
  setWebhookConfig,
  type TaskTypeStats,
  type WebhookConfig,
} from '@/lib/tauri-ipc';

function fmtUsd(cents: number | null): string {
  if (cents == null) return '—';
  const usd = cents / 100;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  return `$${usd.toFixed(2)}`;
}

function fmtSeconds(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export default function Ops() {
  return (
    <div className="mx-auto max-w-5xl px-6 pb-24 pt-20">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Gauge size={22} className="text-[var(--cv-accent)]" />
          <h1 className="text-2xl font-semibold tracking-tight">Ops</h1>
          <Badge
            variant="outline"
            className="border-cyan-500/40 bg-cyan-500/10 text-[10px] uppercase tracking-wider text-[var(--cv-accent)]"
          >
            Beta
          </Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
          Real provider billing pulls, per-task agent observability, and outbound webhook
          notifications — one operational dashboard for the CodeVetter machine.
        </p>
      </header>

      <BillingCard />
      <ObservabilityCard />
      <WebhookCard />
    </div>
  );
}

// ─── Billing ────────────────────────────────────────────────────────────────

function BillingCard() {
  const [anthropic, setAnthropic] = useState('');
  const [openai, setOpenai] = useState('');
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [snapshots, setSnapshots] = useState<BillingSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    if (!isTauriAvailable()) return;
    const cfg = await getBillingConfig();
    setAnthropicConfigured(cfg.anthropic_configured);
    setOpenaiConfigured(cfg.openai_configured);
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getBillingSnapshots();
      setSnapshots(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void refresh();
  }, [loadConfig, refresh]);

  const handleSave = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setSaving(true);
    setError(null);
    try {
      await setBillingConfig({
        anthropic_admin_key: anthropic || null,
        openai_admin_key: openai || null,
      });
      setAnthropic('');
      setOpenai('');
      await loadConfig();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [anthropic, openai, loadConfig, refresh]);

  return (
    <Card className="mb-4 border-[var(--cv-line)] bg-[var(--bg-surface)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard size={16} className="text-[var(--cv-accent)]" />
          Provider billing
        </CardTitle>
        <CardDescription className="text-xs">
          Pulls the actual invoice from Anthropic + OpenAI Admin APIs instead of estimating from
          JSONL totals. Keys live in local preferences; never sent anywhere except the provider's
          own API.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <div>
            <label className="cv-label mb-1 block">
              Anthropic admin key{' '}
              {anthropicConfigured && (
                <Badge
                  variant="outline"
                  className="ml-1 border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-200"
                >
                  configured
                </Badge>
              )}
            </label>
            <Input
              type="password"
              value={anthropic}
              onChange={(e) => setAnthropic(e.target.value)}
              placeholder={anthropicConfigured ? '(stored — replace to update)' : 'sk-ant-admin-…'}
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label className="cv-label mb-1 block">
              OpenAI admin key{' '}
              {openaiConfigured && (
                <Badge
                  variant="outline"
                  className="ml-1 border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-200"
                >
                  configured
                </Badge>
              )}
            </label>
            <Input
              type="password"
              value={openai}
              onChange={(e) => setOpenai(e.target.value)}
              placeholder={openaiConfigured ? '(stored — replace to update)' : 'sk-admin-…'}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 size={12} className="mr-1.5 animate-spin" />
              ) : (
                <Save size={12} className="mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>

        {snapshots.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {snapshots.map((s) => (
              <div
                key={s.provider}
                className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                    {s.provider}
                  </span>
                  {s.configured ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-200"
                    >
                      live
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-slate-500/40 bg-slate-500/10 text-[9px] text-slate-300"
                    >
                      not configured
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                  {fmtUsd(s.usd_cents)}
                </div>
                {s.period_start && s.period_end && (
                  <div className="font-mono text-[10px] text-[var(--text-secondary)]">
                    {s.period_start} → {s.period_end}
                  </div>
                )}
                {s.error && (
                  <div className="mt-1 font-mono text-[10px] text-amber-300/80">{s.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Agent observability ────────────────────────────────────────────────────

function ObservabilityCard() {
  const [data, setData] = useState<AgentObservability | null>(null);
  const [loading, setLoading] = useState(false);
  const [windowDays, setWindowDays] = useState(30);

  const refresh = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setLoading(true);
    try {
      const o = await getAgentObservability(windowDays);
      setData(o);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card className="mb-4 border-[var(--cv-line)] bg-[var(--bg-surface)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge size={16} className="text-[var(--cv-accent)]" />
          Agent observability ({windowDays}d)
        </CardTitle>
        <CardDescription className="text-xs">
          Latency + success rate per task type. Sources:{' '}
          <span className="font-mono">local_reviews</span>,{' '}
          <span className="font-mono">repo_unpacked_reports</span>,{' '}
          <span className="font-mono">cc_sessions</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] p-1 text-[10px]">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setWindowDays(d)}
                className={
                  windowDays === d
                    ? 'rounded bg-cyan-500/10 px-2 py-1 font-medium text-[var(--cv-accent)]'
                    : 'rounded px-2 py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }
              >
                {d}d
              </button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </Button>
        </div>

        {data == null || data.rows.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">
            No task history in this window yet.
          </p>
        ) : (
          <ObservabilityTable rows={data.rows} />
        )}
      </CardContent>
    </Card>
  );
}

function ObservabilityTable({ rows }: { rows: TaskTypeStats[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--cv-line)] text-[var(--text-secondary)]">
            <th className="px-3 py-2 text-left font-normal">task type</th>
            <th className="px-3 py-2 text-right font-normal">sessions</th>
            <th className="px-3 py-2 text-right font-normal">success</th>
            <th className="px-3 py-2 text-right font-normal">fail</th>
            <th className="px-3 py-2 text-right font-normal">rate</th>
            <th className="px-3 py-2 text-right font-normal">p50</th>
            <th className="px-3 py-2 text-right font-normal">p95</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.task_type} className="border-b border-[var(--cv-line)]/40 last:border-0">
              <td className="px-3 py-1.5 font-mono">{r.task_type}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.session_count}</td>
              <td className="px-3 py-1.5 text-right font-mono text-emerald-200">
                {r.success_count}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-red-200">{r.failure_count}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.success_rate_pct.toFixed(1)}%</td>
              <td className="px-3 py-1.5 text-right font-mono">
                {fmtSeconds(r.median_duration_seconds)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">
                {fmtSeconds(r.p95_duration_seconds)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Webhook notifications ──────────────────────────────────────────────────

function WebhookCard() {
  const [url, setUrl] = useState('');
  const [flavor, setFlavor] = useState('slack');
  const [config, setConfig] = useState<WebhookConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);

  const load = useCallback(async () => {
    if (!isTauriAvailable()) return;
    const c = await getWebhookConfig();
    setConfig(c);
    setFlavor(c.flavor);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setSaving(true);
    setError(null);
    try {
      const c = await setWebhookConfig(url, flavor);
      setConfig(c);
      setUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [url, flavor]);

  const handleTest = useCallback(async () => {
    if (!isTauriAvailable()) return;
    setTesting(true);
    setError(null);
    try {
      await sendWebhookNotification({
        title: 'CodeVetter test',
        message:
          'If you see this, the webhook is wired up correctly. T-Rex BLOCK verdicts and high-severity findings will land here too.',
        severity: 'info',
      });
      setTested(true);
      setTimeout(() => setTested(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <Card className="border-[var(--cv-line)] bg-[var(--bg-surface)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell size={16} className="text-[var(--cv-accent)]" />
          Notifications
        </CardTitle>
        <CardDescription className="text-xs">
          Outbound webhook for Slack, Discord, or a generic JSON POST. T-Rex BLOCK + high-severity
          Review findings fire here in future releases; today the Test button validates the wire.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span className="font-mono">{error}</span>
          </div>
        )}

        <div className="space-y-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="cv-label">Webhook URL</label>
              {config?.configured && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-200"
                >
                  configured
                </Badge>
              )}
            </div>
            <Input
              type="password"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={config?.url_preview ?? 'https://hooks.slack.com/services/…'}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="cv-label">Flavor</label>
            <select
              value={flavor}
              onChange={(e) => setFlavor(e.target.value)}
              className="rounded-md border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 py-1 font-mono text-[10px]"
            >
              <option value="slack">Slack (incoming webhook)</option>
              <option value="discord">Discord</option>
              <option value="generic">Generic JSON</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing || !config?.configured}
            >
              {testing ? (
                <Loader2 size={12} className="mr-1.5 animate-spin" />
              ) : tested ? (
                <CheckCircle2 size={12} className="mr-1.5 text-emerald-300" />
              ) : (
                <Send size={12} className="mr-1.5" />
              )}
              Test
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 size={12} className="mr-1.5 animate-spin" />
              ) : (
                <Save size={12} className="mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
