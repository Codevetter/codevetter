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

// Validate anchors against tracked blobs, never the mutable working tree.
// This proves citation identity and bounds, not semantic claim correctness.
export function validateUnpackCitations(report, clone, sha) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha ?? '')) return ['invalid pinned commit'];
  const errors = [];
  const cache = new Map();
  const sections = [
    'system_map',
    'feature_catalog',
    'data_flow',
    'behavior_traces',
    'testing_signals',
    'risk_map',
    'extension_points',
    'agent_handoff',
  ];
  for (const name of sections) {
    const section = report?.[name];
    if (
      typeof section?.summary !== 'string' ||
      !section.summary.trim() ||
      !Array.isArray(section.claims) ||
      !section.claims.length
    ) {
      errors.push(`${name}: missing nonempty section`);
      continue;
    }
    for (const [index, claim] of section.claims.entries())
      errors.push(...validateClaim(claim, `${name}/${index}`, clone, sha, cache));
  }
  return errors;
}

function validateClaim(claim, label, clone, sha, cache) {
  if (
    typeof claim?.claim !== 'string' ||
    !claim.claim.trim() ||
    !['evidence', 'inference'].includes(claim.kind) ||
    !Array.isArray(claim.sources) ||
    !claim.sources.length
  )
    return [`${label}: invalid claim`];
  return claim.sources.flatMap((source) => {
    const error = validateSource(source, clone, sha, cache);
    return error ? [`${label}: ${error}`] : [];
  });
}

function validateSource(source, clone, sha, cache) {
  const match =
    typeof source === 'string' && source.match(/^([^#]+)#L([1-9]\d*)(?:-L?([1-9]\d*))?$/);
  if (
    !match ||
    match[1].startsWith('/') ||
    match[1].includes('\\') ||
    match[1].split('/').some((part) => !part || part === '.' || part === '..')
  )
    return 'unsafe or unanchored citation';
  const path = match[1];
  if (
    path
      .split('/')
      .some((part) =>
        /^(?:\.env(?:\..*)?|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|kubeconfig(?:\.(?:ya?ml|json))?|credentials(?:\.(?:json|ini|toml|ya?ml|cfg|conf))?)$|\.(?:pem|key|p12|pfx)$/i.test(
          part
        )
      )
  )
    return 'prohibited sensitive-file citation';
  if (!cache.has(path)) cache.set(path, trackedLineCount(clone, sha, path));
  const count = cache.get(path);
  const start = Number(match[2]);
  const end = Number(match[3] ?? match[2]);
  if (!count || start > end || end > count) return `missing file or invalid line range: ${source}`;
  return null;
}

function trackedLineCount(clone, sha, path) {
  try {
    const type = execFileSync('git', ['-C', clone, 'cat-file', '-t', `${sha}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (type !== 'blob') return null;
    const text = execFileSync('git', ['-C', clone, 'cat-file', 'blob', `${sha}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (text.includes('\0')) return null;
    return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return null;
  }
}
