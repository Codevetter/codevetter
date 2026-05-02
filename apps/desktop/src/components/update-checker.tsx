import type { Update } from "@tauri-apps/plugin-updater";
import { useCallback,useEffect, useRef, useState } from "react";

import { isTauriAvailable } from "@/lib/tauri-ipc";

const INITIAL_DELAY_MS = 5_000;
const POLL_INTERVAL_MS = 30 * 60 * 1_000; // 30 minutes

interface UpdateInfo {
  version: string;
  body?: string;
}

export default function UpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<Update | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const result = await check();
      if (result?.available) {
        updateRef.current = result;
        setUpdate({
          version: result.version,
          body: result.body ?? undefined,
        });
      }
    } catch {
      // Fail silently — update checks should never block the app
    }
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) return;

    const timeout = setTimeout(() => {
      checkForUpdate();
      intervalRef.current = setInterval(checkForUpdate, POLL_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkForUpdate]);

  const handleInstall = useCallback(async () => {
    if (!updateRef.current) return;
    setInstalling(true);
    try {
      await updateRef.current.downloadAndInstall();
      // Relaunch the app after installing
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      // If install fails, reset state so user can retry
      setInstalling(false);
    }
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 bg-amber-600/95 px-4 py-2 text-sm text-white backdrop-blur-sm">
      <span>
        Update available: <strong>v{update.version}</strong>
      </span>
      <button
        onClick={handleInstall}
        disabled={installing}
        className="rounded bg-white/20 px-3 py-0.5 text-xs font-medium hover:bg-white/30 disabled:opacity-50 transition-colors"
      >
        {installing ? "Installing..." : "Install now"}
      </button>
      <button
        onClick={() => setDismissed(true)}
        disabled={installing}
        className="rounded bg-white/10 px-3 py-0.5 text-xs hover:bg-white/20 disabled:opacity-50 transition-colors"
      >
        Later
      </button>
    </div>
  );
}
