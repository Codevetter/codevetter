import { AlertTriangle, ClipboardCopy, House, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';
import {
  createUiIncident,
  formatUiIncidentDiagnostic,
  recordUiIncident,
  type UiIncident,
  type UiIncidentScope,
} from '@/lib/ui-incident';

interface AppErrorBoundaryProps {
  children: ReactNode;
  scope: UiIncidentScope;
  resetKey?: string;
  onExit?: () => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
  incident: UiIncident | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, incident: null };
  private componentStack: string | null = null;

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const incident = createUiIncident({
      error,
      scope: this.props.scope,
      route: window.location.pathname,
    });
    this.componentStack = info.componentStack ?? null;
    recordUiIncident(incident);
    this.setState({ incident });
    console.error(`[CodeVetter] UI incident ${incident.incident_id}:`, error, info);
  }

  componentDidUpdate(previous: AppErrorBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.reset();
    }
  }

  private reset = () => {
    this.componentStack = null;
    this.setState({ error: null, incident: null });
  };

  render() {
    const { error, incident } = this.state;
    if (error) {
      return (
        <CrashRecoveryPanel
          error={error}
          incident={incident}
          componentStack={this.componentStack}
          scope={this.props.scope}
          onRetry={this.reset}
          onExit={this.props.onExit}
        />
      );
    }
    return this.props.children;
  }
}

interface CrashRecoveryPanelProps {
  error: Error;
  incident: UiIncident | null;
  componentStack?: string | null;
  scope: UiIncidentScope;
  onRetry: () => void;
  onExit?: () => void;
}

function CrashRecoveryPanel({
  error,
  incident,
  componentStack,
  scope,
  onRetry,
  onExit,
}: CrashRecoveryPanelProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const copyDiagnostic = useCallback(async () => {
    if (!incident) return;
    try {
      await navigator.clipboard.writeText(
        formatUiIncidentDiagnostic(incident, error, componentStack)
      );
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }, [componentStack, error, incident]);

  return (
    <section
      aria-labelledby="crash-recovery-title"
      className="flex h-full min-h-0 w-full items-center justify-center overflow-auto bg-[var(--cv-canvas)] p-6 sm:p-10"
      data-testid="crash-recovery"
    >
      <div className="cv-frame w-full max-w-2xl overflow-hidden">
        <div className="flex items-start gap-4 p-5 sm:p-7" role="alert">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-300/15 bg-rose-400/[0.08] text-rose-300">
            <AlertTriangle aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="cv-label mb-2 text-rose-300">Rendering interrupted</p>
            <h1
              ref={titleRef}
              id="crash-recovery-title"
              className="text-xl text-zinc-100 outline-none"
              tabIndex={-1}
            >
              {scope === 'route'
                ? 'This screen stopped unexpectedly'
                : 'CodeVetter stopped rendering'}
            </h1>
            <p className="mt-2 max-w-[68ch] text-sm leading-6 text-zinc-400">
              CodeVetter caught a UI error. It stored a limited incident receipt on this device; no
              diagnostic data was sent anywhere. Repository state was not checked.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-y border-white/[0.07] bg-white/[0.018] px-5 py-4 sm:px-7">
          <Button aria-describedby="retry-description" onClick={onRetry}>
            <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
            {scope === 'route' ? 'Try screen again' : 'Try CodeVetter again'}
          </Button>
          <Button
            aria-describedby="reload-description"
            onClick={() => window.location.reload()}
            variant="outline"
          >
            Reload CodeVetter
          </Button>
          <Button onClick={onExit ?? (() => window.location.assign('/'))} variant="ghost">
            <House aria-hidden="true" className="mr-2 h-4 w-4" />
            Return to Usage
          </Button>
          <div className="basis-full text-xs leading-5 text-zinc-400">
            <span id="retry-description">Retry keeps the current app session.</span>{' '}
            <span id="reload-description">Reload restarts the desktop interface.</span>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-7">
          <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-zinc-400">Incident</dt>
              <dd className="mono mt-1 truncate text-zinc-300">
                {incident?.incident_id ?? 'Preparing local receipt…'}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-400">Recovery scope</dt>
              <dd className="mt-1 text-zinc-300">
                {scope === 'route' ? 'This screen only' : 'Application shell'}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex items-center gap-2 text-xs text-emerald-300">
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
              Local-only incident receipt
            </div>
            <Button
              disabled={!incident}
              onClick={() => void copyDiagnostic()}
              size="sm"
              variant="outline"
            >
              <ClipboardCopy aria-hidden="true" className="mr-2 h-4 w-4" />
              Copy technical details
            </Button>
            <p aria-live="polite" className="min-h-4 text-xs text-zinc-400">
              {copyStatus === 'copied' && 'Copied to the clipboard.'}
              {copyStatus === 'failed' && 'Clipboard unavailable. Reload and try again.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
