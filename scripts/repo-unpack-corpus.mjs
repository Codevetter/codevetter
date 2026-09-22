import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const corpusRoot = join(repositoryRoot, 'benchmarks/repo-unpacks');

export function repoUnpackCorpusPath(slug) {
  return join(corpusRoot, `${slug}.json`);
}

export function gitHeadSha(repositoryPath) {
  return execFileSync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}
