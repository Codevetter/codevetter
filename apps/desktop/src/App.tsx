import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import CommandPalette from '@/components/command-palette';
import KeyboardShortcuts from '@/components/keyboard-shortcuts';
import Onboarding from '@/components/onboarding';
import { PersistentRoutes } from '@/components/persistent-routes';
import Sidebar from '@/components/sidebar';
import UpdateChecker from '@/components/update-checker';
import { trackAppLaunch } from '@/lib/analytics';
import { ProjectWorkspaceProvider } from '@/lib/project-workspace';
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, close };
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

class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Full detail goes to the console (DevTools) — never to the user.
    console.error('[CodeVetter] Route error boundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <h2 className="text-lg font-semibold text-red-400 mb-2">Something went wrong</h2>
          <p className="text-sm text-slate-400 mb-4 max-w-md">
            This screen hit an unexpected error. Your saved data is safe — try again, and if it
            keeps happening, restart the app.
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-500 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Main shell: one fixed navigation rail and one shared content inset. */
function Shell() {
  const { showOnboarding, setShowOnboarding, ready } = useOnboarding();
  const { isOpen, close } = useCommandPalette();
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
        <main className="cv-content-frame box-border flex h-full min-h-0 min-w-0 flex-1 flex-col pt-14">
          <RouteErrorBoundary>
            <Outlet />
          </RouteErrorBoundary>
        </main>
        <CommandPalette isOpen={isOpen} onClose={close} />
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

  return (
    <Routes>
      <Route path="/intel" element={<RedirectIntelToRepo />} />
      <Route path="/rubrics" element={<RedirectToSettings section="rubrics" />} />
      <Route path="/ops" element={<RedirectToSettings section="ops" />} />
      <Route path="/agent-memories" element={<RedirectToSettings section="memories" />} />
      <Route path="/workbench" element={<Navigate to="/" replace />} />
      <Route path="/fleet" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route path="*" element={<PersistentRoutes />} />
      </Route>
    </Routes>
  );
}
