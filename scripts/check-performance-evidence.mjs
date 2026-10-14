import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

const artifactPattern = /^evidence\/performance\/[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.(?:json|md)$/;
const manifestPattern = /^evidence\/performance\/reviewed-artifacts-\d{4}-\d{2}-\d{2}\.json$/;
const limits = Object.freeze({ files: 16, lines: 4_000, bytes: 1024 * 1024 });

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function readRegularFile(root, relativePath) {
  const absolute = path.join(root, relativePath);
  requireCondition(lstatSync(absolute).isFile(), `Not a regular file: ${relativePath}`);
  return readFileSync(absolute);
}

function lineCount(bytes) {
  if (bytes.length === 0) return 0;
  const newlines = bytes.reduce((count, byte) => count + Number(byte === 10), 0);
  return newlines + Number(bytes.at(-1) !== 10);
}

function hasSourceIdentity(record) {
  const values = [
    record.implementation_sha256,
    record.candidate_implementation_sha256,
    record.implementation,
    record.reviewed_tree,
  ];
  return values.some((value) => {
    if (typeof value === 'string') return /^[a-f0-9]{40,64}$/.test(value);
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).some((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
    );
  });
}

// A large, immutable evidence batch may be accounted separately from source.
// This verifies artifact identity and size, not the truth of experimental claims.
export function assessPerformanceEvidence(root, base, changedPaths, addedPaths) {
  try {
    const changed = new Set(changedPaths);
    const added = new Set(addedPaths);
    requireCondition(changed.size === changedPaths.length, 'Duplicate changed path');
    requireCondition(added.size === addedPaths.length, 'Duplicate added path');
    const manifests = changedPaths.filter((file) => manifestPattern.test(file));
    requireCondition(manifests.length === 1, 'Exactly one dated evidence manifest required');
    const manifestPath = manifests[0];
    requireCondition(added.has(manifestPath), 'Evidence manifest must be added');
    const manifest = JSON.parse(readRegularFile(root, manifestPath));
    requireCondition(manifest.schemaVersion === 1, 'Unsupported evidence manifest schema');
    requireCondition(
      manifest.reviewedBase === base && /^[a-f0-9]{40}$/.test(manifest.reviewedHead),
      'Evidence manifest source revision differs'
    );
    requireCondition(
      typeof manifest.scope === 'string' && manifest.scope.length > 0,
      'Missing evidence scope'
    );
    requireCondition(Array.isArray(manifest.artifacts), 'Missing evidence artifact list');
    requireCondition(
      manifest.artifacts.length > 0 && manifest.artifacts.length <= limits.files,
      'Evidence file cap exceeded'
    );
    const eligible = changedPaths.filter(
      (file) => artifactPattern.test(file) && file !== manifestPath && added.has(file)
    );
    requireCondition(
      eligible.length === manifest.artifacts.length,
      'Evidence manifest does not cover exact changed artifact set'
    );
    const listed = new Set();
    let lines = 0;
    let bytes = 0;
    for (const entry of manifest.artifacts) {
      requireCondition(entry && typeof entry === 'object', 'Malformed evidence entry');
      const { path: file, sha256 } = entry;
      requireCondition(
        typeof file === 'string' && artifactPattern.test(file),
        `Invalid evidence path: ${file}`
      );
      requireCondition(!listed.has(file), `Duplicate evidence artifact: ${file}`);
      requireCondition(
        added.has(file) && changed.has(file),
        `Evidence artifact must be newly added: ${file}`
      );
      requireCondition(/^[a-f0-9]{64}$/.test(sha256), `Invalid evidence hash: ${file}`);
      listed.add(file);
      const content = readRegularFile(root, file);
      requireCondition(
        createHash('sha256').update(content).digest('hex') === sha256,
        `Evidence hash differs: ${file}`
      );
      if (file.endsWith('.json')) {
        const record = JSON.parse(content);
        requireCondition(
          record &&
            typeof record.schema_version === 'string' &&
            record.schema_version.startsWith('codevetter.') &&
            hasSourceIdentity(record) &&
            (record.runtime || record.compiler),
          `Missing schema or source identity: ${file}`
        );
      } else {
        requireCondition(
          /^# .+/m.test(content.toString('utf8')),
          `Missing Markdown heading: ${file}`
        );
      }
      lines += lineCount(content);
      bytes += content.length;
    }
    requireCondition(
      eligible.every((file) => listed.has(file)),
      'Unlisted evidence artifact'
    );
    requireCondition(lines <= limits.lines, 'Evidence line cap exceeded');
    requireCondition(bytes <= limits.bytes, 'Evidence byte cap exceeded');
    return { passed: true, artifacts: [...listed], lines, bytes };
  } catch (error) {
    return { passed: false, reason: error.message, artifacts: [] };
  }
}
