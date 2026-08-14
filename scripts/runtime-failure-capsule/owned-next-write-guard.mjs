import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function installOwnedNextWriteGuard(root) {
  const protectedPaths = new Set([resolve(root, 'next-env.d.ts'), resolve(root, 'tsconfig.json')]);
  const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
  fs.promises.writeFile = async (path, ...args) => {
    if (protectedPaths.has(normalizeWritePath(path))) return;
    return originalWriteFile(path, ...args);
  };
  const originalWriteFileSync = fs.writeFileSync.bind(fs);
  fs.writeFileSync = (path, ...args) => {
    if (protectedPaths.has(normalizeWritePath(path))) return;
    return originalWriteFileSync(path, ...args);
  };
}

function normalizeWritePath(path) {
  try {
    return resolve(path instanceof URL ? fileURLToPath(path) : String(path));
  } catch {
    return '<invalid>';
  }
}
