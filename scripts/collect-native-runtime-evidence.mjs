#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

// Only the isolated runner's own UI-test log markers identify capture roots.
// Do not search a user's desktop, inspect recordings, or follow symlinks.
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Runtime evidence collection requires the isolated GitHub runner.');
}
const logs = resolve('artifacts/native-tool-logs');
const output = resolve('artifacts/native-owner-review-ci/runtime-invocations');
const roots = new Set();
for (const name of readdirSync(logs).filter((name) => name.endsWith('.log'))) {
  const text = readFileSync(join(logs, name), 'utf8');
  for (const match of text.matchAll(
    /CODEVETTER_RUNTIME_CAPTURE_ROOT=(\/\S*\/codevetter-runtime-invocations-\d+)/g
  )) {
    roots.add(match[1]);
  }
}
mkdirSync(output, { recursive: true });
let count = 0;
for (const root of roots) {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) continue;
  const path = realpathSync(root);
  const allowed = [join(homedir(), 'Library/Containers'), '/private/var/folders', '/var/folders'];
  if (
    !allowed.some((parent) => path.startsWith(parent + sep)) ||
    !/^codevetter-runtime-invocations-\d+$/.test(basename(path))
  ) {
    throw new Error('Unexpected UI-test capture root.');
  }
  for (const name of readdirSync(path)) {
    if (!/^[\w-]+\.(png|json|accessibility\.txt)$/.test(name)) continue;
    const source = join(path, name);
    const stat = lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
      throw new Error('Unexpected UI-test capture file.');
    }
    if (++count > 120) throw new Error('UI-test capture count exceeds the bounded packet.');
    copyFileSync(source, join(output, basename(path) + '-' + name));
  }
}
console.log(`Retained ${count} runtime capture files from ${roots.size} UI-test roots.`);
