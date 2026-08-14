import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function ensureCodeVetterEvidenceRoot(repositoryRoot) {
  const directory = join(resolve(repositoryRoot), '.codevetter');
  await mkdir(directory, { recursive: true });
  const ignorePath = join(directory, '.gitignore');
  try {
    await writeFile(ignorePath, '*\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { directory, ignore_created: true };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const details = await stat(ignorePath);
    if (!details.isFile()) throw new Error('.codevetter/.gitignore is not a regular file');
    return { directory, ignore_created: false };
  }
}
