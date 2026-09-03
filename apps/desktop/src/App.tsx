import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import CommandPalette from '@/components/command-palette';
import KeyboardShortcuts from '@/components/keyboard-shortcuts';
import Onboarding from '@/components/onboarding';
import { PersistentRoutes } from '@/components/persistent-routes';
import Sidebar from '@/components/sidebar';
import UpdateChecker from '@/components/update-checker';
import { trackAppLaunch } from '@/lib/analytics';
import { ProjectWorkspaceProvider } from '@/lib/project-workspace';
import { migrateLegacyRubricConfig } from '@/lib/rubric-migration';
import { getPreference, isTauriAvailable } from '@/lib/tauri-ipc';
import { useWindowVisibilityClass } from '@/lib/use-visibility';

function RedirectToSettings({ section }: { section: string }) {
  return <Navigate to={`/settings?section=${section}`} replace />;
}

function RedirectIntelToRepo() {
  return <Navigate to="/unpack?section=activity" replace />;
}

/** Hook: open/close command palette via Cmd+K */
function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const rememberFocus = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => {
          if (!prev) rememberFocus();
          return !prev;
        });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rememberFocus]);

  const open = useCallback(() => {
    rememberFocus();
    setIsOpen(true);
  }, [rememberFocus]);
  const close = useCallback(() => setIsOpen(false), []);
  const restoreFocus = useCallback((event: Event) => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (!target?.isConnected) return;
    event.preventDefault();
    target.focus();
  }, []);
  return { isOpen, open, close, restoreFocus };
}

function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (localStorage.getItem('onboarding_complete') === 'true') {
        setReady(true);
        return;
      }
      if (!isTauriAvailable()) {
        setReady(true);
        return;
      }
      try {
        const completed = await getPreference('onboarding_complete');
        if (completed === 'true') {
          localStorage.setItem('onboarding_complete', 'true');
        } else {
          setShowOnboarding(true);
        }
      } catch {
        // If preferences aren't available yet, show the app anyway
      }
      setReady(true);
    })();
  }, []);

  return { showOnboarding, setShowOnboarding, ready };
}

/** Main shell: one fixed navigation rail and one shared content inset. */
function Shell() {
  const location = useLocation();
  const { showOnboarding, setShowOnboarding, ready } = useOnboarding();
  const { isOpen, open, close, restoreFocus } = useCommandPalette();
  // Freeze CSS animations when the window is hidden/minimized (battery).
  useWindowVisibilityClass();

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-main)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cv-accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <ProjectWorkspaceProvider>
      <div className="cv-app flex h-full w-full text-[var(--text-primary)]">
        <div className="cv-ambient" aria-hidden="true" />
        <UpdateChecker />
        {showOnboarding && <Onboarding onComplete={() => setShowOnboarding(false)} />}
        <Sidebar />
        <main className="cv-content-frame box-border flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <header className="no-drag flex h-12 shrink-0 items-center justify-center border-b border-white/[0.065] bg-[#090a0b] px-4">
            <button
              type="button"
              onClick={open}
              className="group flex h-[32px] w-full max-w-[420px] items-center gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-left text-[12px] text-zinc-400 transition-[border-color,background-color,color] duration-150 hover:border-white/[0.14] hover:bg-white/[0.055] hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090a0b]"
              aria-label="Search commands"
            >
              <Search size={14} className="shrink-0 text-zinc-500 group-hover:text-zinc-300" />
              <span className="min-w-0 flex-1 truncate">Search commands</span>
              <kbd className="rounded border border-white/[0.08] bg-black/20 px-1.5 py-0.5 font-sans text-[10px] text-zinc-400">
                ⌘K
              </kbd>
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">
            <AppErrorBoundary
              scope="route"
              resetKey={location.key}
              onExit={() => window.location.assign('/')}
            >
              <Outlet />
            </AppErrorBoundary>
          </div>
        </main>
        <CommandPalette isOpen={isOpen} onClose={close} onCloseAutoFocus={restoreFocus} />
        <KeyboardShortcuts />
      </div>
    </ProjectWorkspaceProvider>
  );
}

export default function App() {
  // Owner-facing analytics: emits `signup` on first launch, `returned` after.
  // Self-dedupes via localStorage; safe to run once per app mount.
  useEffect(() => {
    trackAppLaunch();
  }, []);

  useEffect(() => {
    // A failed attempt leaves the sanitized WebView copy intact. Opening the
    // incumbent Rubrics surface retries and exposes its existing sync warning.
    void migrateLegacyRubricConfig().catch(() => undefined);
  }, []);

  return (
    <Routes>
      <Route path="/intel" element={<RedirectIntelToRepo />} />
      <Route path="/rubrics" element={<RedirectToSettings section="rubrics" />} />
      <Route path="/ops" element={<RedirectToSettings section="ops" />} />
      <Route path="/agent-memories" element={<RedirectToSettings section="memories" />} />
      <Route path="/workbench" element={<Navigate to="/" replace />} />
      <Route path="/fleet" element={<Navigate to="/" replace />} />
      <Route path="/agents/*" element={<Navigate to="/" replace />} />
      <Route path="/board/*" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route path="*" element={<PersistentRoutes />} />
      </Route>
    </Routes>
  );
}
