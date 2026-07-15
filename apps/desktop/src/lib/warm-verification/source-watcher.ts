import { watch } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type { VerifyConfigSnapshot } from './config-loader';

interface DirectoryWatcher {
  close(): void;
  on?(event: 'error', listener: (error: Error) => void): void;
}

export type WatchDirectory = (
  directory: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => DirectoryWatcher;

export interface VerificationSourceWatch {
  readonly changed: boolean;
  readonly changedPaths: readonly string[];
  close(): void;
}

export async function watchVerificationSources(
  repoRoot: string,
  config: VerifyConfigSnapshot,
  changedPaths: readonly string[],
  onChange: (relativePath: string) => void,
  watchDirectory: WatchDirectory = defaultWatchDirectory
): Promise<VerificationSourceWatch> {
  const canonicalRoot = await realpath(repoRoot);
  const sources = verificationSourcePaths(canonicalRoot, config, changedPaths);
  const byDirectory = new Map<string, Map<string, string>>();

  for (const relativePath of sources) {
    const absolutePath = path.resolve(canonicalRoot, relativePath);
    const canonicalDirectory = await realpath(path.dirname(absolutePath));
    assertWithinRepo(canonicalRoot, canonicalDirectory, relativePath);
    const entries = byDirectory.get(canonicalDirectory) ?? new Map<string, string>();
    entries.set(path.basename(absolutePath), relativePath);
    byDirectory.set(canonicalDirectory, entries);
  }

  const changed = new Set<string>();
  const watchers: DirectoryWatcher[] = [];
  const markChanged = (relativePath: string) => {
    if (changed.has(relativePath)) return;
    changed.add(relativePath);
    onChange(relativePath);
  };

  try {
    for (const [directory, entries] of byDirectory) {
      const watcher = watchDirectory(directory, (_eventType, filename) => {
        if (filename === null) {
          for (const relativePath of entries.values()) markChanged(relativePath);
          return;
        }
        const relativePath = entries.get(
          Buffer.isBuffer(filename) ? filename.toString() : filename
        );
        if (relativePath) markChanged(relativePath);
      });
      watchers.push(watcher);
      watcher.on?.('error', () => {
        for (const relativePath of entries.values()) markChanged(relativePath);
      });
    }
  } catch (error) {
    closeWatchers(watchers);
    throw error;
  }

  let closed = false;
  return {
    get changed() {
      return changed.size > 0;
    },
    get changedPaths() {
      return [...changed].sort();
    },
    close() {
      if (closed) return;
      closed = true;
      closeWatchers(watchers);
    },
  };
}

export function verificationSourcePaths(
  repoRoot: string,
  config: VerifyConfigSnapshot,
  changedPaths: readonly string[]
): string[] {
  const candidates = [
    path.relative(repoRoot, config.configPath),
    ...config.config.scenarioModules,
    ...Object.values(config.config.authProfiles).map((profile) => profile.storageState),
    ...changedPaths,
  ];
  return [...new Set(candidates)]
    .map((candidate) => {
      const absolutePath = path.resolve(repoRoot, candidate);
      assertWithinRepo(repoRoot, absolutePath, candidate);
      return path.relative(repoRoot, absolutePath);
    })
    .sort();
}

function assertWithinRepo(repoRoot: string, candidate: string, source: string): void {
  if (candidate !== repoRoot && !candidate.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`Verification watch path escapes repository: ${source}`);
  }
}

const defaultWatchDirectory: WatchDirectory = (directory, listener) =>
  watch(directory, { persistent: false, recursive: false }, listener);

function closeWatchers(watchers: readonly DirectoryWatcher[]): void {
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // Cleanup is best-effort per handle so one failed close cannot leak the rest.
    }
  }
}
