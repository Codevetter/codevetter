import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repositoryRelative } from './contracts.mjs';
import { ownedSupervisionInputs, isOwnedSupervisionOutput } from './supervised-inputs.mjs';

// Bind raw bytes, not Git's dirty boolean or normalized/textconv diff. Only the
// opaque digest leaves this boundary. Ignored outputs/dependencies are not inputs.
export async function performanceInputIdentity(root, ownedRunDirectory) {
  const owned = await ownedSupervisionInputs(root, ownedRunDirectory);
  const paths = await inputPaths(root, owned);
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ owned_output_directory: owned }));
  let bytes = 0;
  for (const path of paths) {
    const absolute = resolve(root, path);
    hash.update(JSON.stringify(path));
    let info;
    try {
      info = await lstat(absolute);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update(':deleted\0');
      continue;
    }
    if (info.isSymbolicLink()) {
      hash.update(`:link:${JSON.stringify(await readlink(absolute))}`);
      if (repositoryRelative(root, await realpath(absolute)) === null)
        throw new Error('performance input symlink escapes repository');
      info = await stat(absolute);
    }
    if (!info.isFile()) throw new Error('performance input is not a regular file');
    if (bytes + info.size > 256 * 1024 * 1024)
      throw new Error('performance input snapshot exceeds 256 MiB');
    const content = createHash('sha256');
    for await (const chunk of createReadStream(absolute)) {
      bytes += chunk.length;
      if (bytes > 256 * 1024 * 1024) throw new Error('performance input snapshot exceeds 256 MiB');
      content.update(chunk);
    }
    hash.update(`:mode:${info.mode & 0o111}:sha256:${content.digest('hex')}\0`);
  }
  return `worktree-sha256:${hash.digest('hex')}`;
}

function inputPaths(root, owned) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'git',
      ['ls-files', '-t', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const chunks = [];
    let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0 || size > 4 * 1024 * 1024)
        return reject(new Error('performance input inventory unavailable or oversized'));
      const inventory = Buffer.concat(chunks);
      const decoded = inventory.toString('utf8');
      if (!Buffer.from(decoded).equals(inventory))
        return reject(new Error('performance input filenames are not valid UTF-8'));
      const paths = [
        ...new Set(
          decoded
            .split('\0')
            .filter(Boolean)
            .filter((entry) => !isOwnedSupervisionOutput(entry, owned))
            .map((entry) => entry.slice(2))
        ),
      ].sort();
      if (paths.length > 10000)
        return reject(new Error('performance input snapshot exceeds 10000 files'));
      resolvePromise(paths);
    });
  });
}
