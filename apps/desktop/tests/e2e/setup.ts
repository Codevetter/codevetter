import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tauriDriver: ChildProcess | null = null;

/**
 * Start tauri-driver (WebDriver server for Tauri apps).
 * Listens on http://localhost:4444 by default.
 */
export async function startTauriDriver(port = 4444): Promise<void> {
  if (tauriDriver) return;

  tauriDriver = spawn('tauri-driver', ['--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  tauriDriver.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString();
    if (process.env.DEBUG_TAURI_DRIVER) {
      console.error('[tauri-driver]', msg);
    }
  });

  tauriDriver.on('error', (err) => {
    console.error('Failed to start tauri-driver:', err.message);
    console.error('Install it with: cargo install tauri-driver');
    tauriDriver = null;
  });

  // Wait for the WebDriver server to be ready
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(`http://localhost:${port}/status`);
      if (resp.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`tauri-driver did not become ready on port ${port} after ${maxAttempts * 250}ms`);
}

/**
 * Stop tauri-driver if running.
 */
export async function stopTauriDriver(): Promise<void> {
  if (!tauriDriver) return;
  tauriDriver.kill('SIGTERM');
  tauriDriver = null;
  // Give it a moment to clean up
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Get the path to the built CodeVetter app binary.
 * Requires `npm run tauri:build` to have been run first.
 *
 * Checks arch-specific path first, then falls back to default target path.
 */
export function getAppBinaryPath(): string {
  const arch = os.arch() === 'arm64' ? 'aarch64' : 'x86_64';
  const tauriTarget = `${arch}-apple-darwin`;

  // Tauri v2 build output location (arch-specific)
  const archPath = path.resolve(
    __dirname,
    '../../src-tauri/target',
    tauriTarget,
    'release/bundle/macos/CodeVetter.app/Contents/MacOS/CodeVetter'
  );

  // Fallback: default target (no triple)
  const defaultPath = path.resolve(
    __dirname,
    '../../src-tauri/target/release/bundle/macos/CodeVetter.app/Contents/MacOS/CodeVetter'
  );

  if (fs.existsSync(archPath)) return archPath;
  if (fs.existsSync(defaultPath)) return defaultPath;

  // Return the arch-specific path (will fail with a clear error later)
  return archPath;
}

/**
 * Build WebDriver capabilities for the Tauri app.
 */
export function getTauriCapabilities() {
  return {
    'tauri:options': {
      application: getAppBinaryPath(),
    },
  };
}
