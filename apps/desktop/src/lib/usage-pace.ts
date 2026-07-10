export const USAGE_WINDOW_SECS = {
  FIVE_HOURS: 5 * 3600,
  DAY: 24 * 3600,
  WEEK: 7 * 24 * 3600,
  MONTH: 30 * 24 * 3600,
} as const;

export type UsageWindowSlot = 'primary' | 'secondary';

/** Total quota window length in seconds — prefer API value when present. */
export function resolveUsageWindowTotalSecs(
  provider: string,
  slot: UsageWindowSlot,
  fromApi?: number | null
): number | undefined {
  if (fromApi != null && fromApi > 0) return fromApi;

  switch (provider) {
    case 'cursor':
      return slot === 'primary' ? USAGE_WINDOW_SECS.MONTH : undefined;
    case 'devin':
      return slot === 'primary' ? USAGE_WINDOW_SECS.WEEK : USAGE_WINDOW_SECS.DAY;
    case 'grok':
      return undefined;
    case 'anthropic':
      return slot === 'primary' ? USAGE_WINDOW_SECS.FIVE_HOURS : USAGE_WINDOW_SECS.WEEK;
    default:
      return slot === 'primary' ? USAGE_WINDOW_SECS.FIVE_HOURS : USAGE_WINDOW_SECS.WEEK;
  }
}

export function computeUsagePaceLabel(
  pct: number,
  windowTotalSecs?: number,
  resetsInSecs?: number
): { label: string | null; tone: 'muted' | 'warn' | 'ok' } {
  if (
    !windowTotalSecs ||
    windowTotalSecs <= 0 ||
    resetsInSecs == null ||
    resetsInSecs <= 0 ||
    resetsInSecs > windowTotalSecs
  ) {
    return { label: null, tone: 'muted' };
  }

  const elapsed = windowTotalSecs - resetsInSecs;
  if (elapsed < 10 * 60 || pct < 0.5) {
    return { label: null, tone: 'muted' };
  }

  const projectedEndPct = pct * (windowTotalSecs / elapsed);
  if (projectedEndPct >= 100) {
    const secsToCap = ((100 - pct) * elapsed) / pct;
    if (secsToCap <= 0) return { label: 'at limit', tone: 'warn' };
    if (secsToCap < resetsInSecs)
      return { label: `caps in ${formatDuration(secsToCap)}`, tone: 'warn' };
    return { label: 'on pace', tone: 'muted' };
  }
  if (projectedEndPct >= 95) {
    return { label: 'on pace', tone: 'muted' };
  }
  return { label: `${Math.round(100 - projectedEndPct)}% headroom`, tone: 'ok' };
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}
