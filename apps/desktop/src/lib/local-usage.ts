import type {
  AgentDayUsage,
  AgentUsageRow,
  LocalUsageReport,
  LocalUsageSession,
  ModelUsage,
  TokenUsageStats,
} from './tauri-ipc';

const agentName = (agent: string) => (agent === 'claude' ? 'claude-code' : agent);
const generated = (totals: LocalUsageReport['totals']) =>
  totals.input_tokens + totals.cache_creation_tokens + totals.output_tokens;

function localDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function startOfWeek(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return localDay(date);
}

export function ccusageAgentDays(report: LocalUsageReport): AgentDayUsage[] {
  return report.daily.flatMap((period) =>
    period.agents.map((agent) => ({
      date: period.period,
      agent_type: agentName(agent.agent),
      generated: generated(agent.totals),
      cache: agent.totals.cache_read_tokens,
      cost: agent.totals.cost_usd,
    }))
  );
}

export function usageStats(rows: AgentDayUsage[], now = new Date()): TokenUsageStats {
  const today = localDay(now);
  const week = startOfWeek(today);
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const sum = (predicate: (day: string) => boolean, field: 'generated' | 'cache' | 'cost') =>
    rows.filter((row) => predicate(row.date)).reduce((total, row) => total + row[field], 0);
  const days = new Map<string, { generated: number; cache: number; cost: number }>();
  for (const row of rows) {
    const bucket = days.get(row.date) ?? { generated: 0, cache: 0, cost: 0 };
    bucket.generated += row.generated;
    bucket.cache += row.cache;
    bucket.cost += row.cost;
    days.set(row.date, bucket);
  }
  const weeks = new Map<string, { generated: number; cache: number; cost: number }>();
  for (const [day, bucket] of days) {
    const key = startOfWeek(day);
    const current = weeks.get(key) ?? { generated: 0, cache: 0, cost: 0 };
    current.generated += bucket.generated;
    current.cache += bucket.cache;
    current.cost += bucket.cost;
    weeks.set(key, current);
  }
  const period = (predicate: (day: string) => boolean) => ({
    generated: sum(predicate, 'generated'),
    cache: sum(predicate, 'cache'),
    cost: sum(predicate, 'cost'),
  });
  const todayTotals = period((day) => day === today);
  const weekTotals = period((day) => day >= week);
  const monthTotals = period((day) => day.startsWith(month));
  const yearTotals = period((day) => day.startsWith(year));
  return {
    today: todayTotals.generated + todayTotals.cache,
    this_week: weekTotals.generated + weekTotals.cache,
    this_month: monthTotals.generated + monthTotals.cache,
    this_year: yearTotals.generated + yearTotals.cache,
    today_generated: todayTotals.generated,
    week_generated: weekTotals.generated,
    month_generated: monthTotals.generated,
    year_generated: yearTotals.generated,
    today_cost: todayTotals.cost,
    week_cost: weekTotals.cost,
    month_cost: monthTotals.cost,
    year_cost: yearTotals.cost,
    daily_series: [...days.entries()].sort().map(([date, value]) => ({
      date,
      tokens: value.generated + value.cache,
      ...value,
    })),
    weekly_series: [...weeks.entries()].sort().map(([week_start, value]) => ({
      week_start,
      tokens: value.generated + value.cache,
      ...value,
    })),
  };
}

function sessionInWindow(session: LocalUsageSession, since?: string, until?: string): boolean {
  if (!since && !until) return true;
  if (!session.last_activity) return false;
  const day = session.last_activity.slice(0, 10);
  return (!since || day >= since) && (!until || day < until);
}

export function ccusageModels(
  report: LocalUsageReport,
  since?: string,
  until?: string,
  hiddenAgents: Set<string> = new Set()
): ModelUsage[] {
  const models = new Map<string, ModelUsage>();
  for (const session of report.sessions) {
    if (hiddenAgents.has(agentName(session.agent)) || !sessionInWindow(session, since, until)) {
      continue;
    }
    for (const model of session.models) {
      const row = models.get(model.model) ?? {
        model: model.model,
        sessions: 0,
        generated: 0,
        cache: 0,
        cost: 0,
      };
      row.sessions += 1;
      row.generated += generated(model.totals);
      row.cache += model.totals.cache_read_tokens;
      row.cost += model.totals.cost_usd;
      models.set(model.model, row);
    }
  }
  return [...models.values()].sort((left, right) => right.cost - left.cost);
}

export function ccusageAgentRows(report: LocalUsageReport): AgentUsageRow[] {
  const rows = new Map<string, AgentUsageRow>();
  const week = startOfWeek(localDay(new Date()));
  for (const session of report.sessions) {
    const agent = agentName(session.agent);
    const row = rows.get(agent) ?? {
      agent_type: agent,
      sessions: 0,
      real_input_tokens: 0,
      cache_read_tokens: 0,
      output_tokens: 0,
      week_real_input_tokens: 0,
      week_output_tokens: 0,
      cost: 0,
    };
    row.sessions += 1;
    row.real_input_tokens += session.totals.input_tokens + session.totals.cache_creation_tokens;
    row.cache_read_tokens += session.totals.cache_read_tokens;
    row.output_tokens += session.totals.output_tokens;
    row.cost += session.totals.cost_usd;
    if (session.last_activity && session.last_activity.slice(0, 10) >= week) {
      row.week_real_input_tokens +=
        session.totals.input_tokens + session.totals.cache_creation_tokens;
      row.week_output_tokens += session.totals.output_tokens;
    }
    rows.set(agent, row);
  }
  return [...rows.values()];
}
