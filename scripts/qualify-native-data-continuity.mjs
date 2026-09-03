#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const snapshotSchema = 'codevetter.native-data-snapshot/v1';
const continuitySchema = 'codevetter.native-data-continuity/v1';
const productionAppDataIdentity = 'com.codevetter.desktop';
const sqlite = '/usr/bin/sqlite3';
const pathArguments = new Map([
  ['--database', 'database'],
  ['--baseline', 'baseline'],
  ['--before', 'before'],
  ['--after-upgrade', 'afterUpgrade'],
  ['--after-rollback', 'afterRollback'],
  ['--out', 'out'],
]);

const durableIdentityTables = [
  ['cc_projects', 'id'],
  ['cc_sessions', 'id'],
  ['local_reviews', 'id'],
  ['local_review_findings', 'id'],
  ['trex_watchers', 'repo_path'],
  ['trex_pr_runs', 'id'],
  ['trex_preview_runs', 'id'],
  ['repo_projects', 'id'],
  ['repo_unpacked_reports', 'id'],
  ['preferences', 'key'],
  ['workspaces', 'id'],
  ['agent_tasks', 'id'],
  ['local_check_runs', 'run_id'],
  ['managed_work_runs', 'id'],
];

export function parseArguments(argv) {
  const operation = argv[0];
  if (!['capture', 'compare'].includes(operation)) {
    throw new Error('Expected capture or compare');
  }
  const options = { operation };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    const pathKey = pathArguments.get(argument);
    if (pathKey) {
      options[pathKey] = resolve(requiredValue(argv, ++index, argument));
      continue;
    }
    if (argument === '--phase') {
      options.phase = requiredValue(argv, ++index, argument);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  validateArguments(options);
  return options;
}

function validateArguments(options) {
  if (!options.out) throw new Error('--out is required');
  if (options.operation === 'capture') validateCaptureArguments(options);
  else if (!options.before || !options.afterUpgrade || !options.afterRollback) {
    throw new Error('compare requires --before, --after-upgrade, and --after-rollback');
  }
}

function validateCaptureArguments(options) {
  if (!options.database) throw new Error('--database is required');
  if (!['before', 'after_upgrade', 'after_rollback'].includes(options.phase)) {
    throw new Error('--phase must be before, after_upgrade, or after_rollback');
  }
  if (options.phase === 'before' && options.baseline) {
    throw new Error('The before phase must not receive --baseline');
  }
  if (options.phase !== 'before' && !options.baseline) {
    throw new Error(`${options.phase} requires --baseline`);
  }
}

export function captureDataSnapshot({
  databasePath,
  phase,
  baseline = null,
  recordedAt = new Date().toISOString(),
  probeNonce = randomBytes(32).toString('hex'),
  query = queryDatabase,
}) {
  if (!['before', 'after_upgrade', 'after_rollback'].includes(phase)) {
    throw new Error(`Unsupported data-continuity phase: ${phase}`);
  }
  const database = realpathSync(databasePath);
  if (basename(database) !== 'codevetter.db') {
    throw new Error('The continuity probe only accepts codevetter.db');
  }
  if (basename(dirname(database)) !== productionAppDataIdentity) {
    throw new Error(`The database parent must be ${productionAppDataIdentity}`);
  }
  if (phase === 'before' && baseline) throw new Error('Before capture cannot use a baseline');
  if (phase !== 'before') validateBaseline(baseline);

  const nonce = baseline?.probe_nonce ?? probeNonce;
  if (!canonicalSHA256(nonce)) throw new Error('The probe nonce must be 32-byte lowercase hex');
  const rows = query(database);
  const currentHashes = new Set(
    rows.records.map(({ table, identity }) => recordHash(nonce, table, identity))
  );
  const expectedHashes = baseline?.record_hashes ?? [...currentHashes].sort();
  const preservedHashes = expectedHashes.filter((hash) => currentHashes.has(hash)).sort();
  const tableCounts = Object.fromEntries(
    durableIdentityTables.map(([table]) => [table, rows.tableCounts[table] ?? 0])
  );

  return {
    schema_version: snapshotSchema,
    authority: 'read_only_identity_probe',
    recorded_at: recordedAt,
    phase,
    app_data_identity: productionAppDataIdentity,
    database_filename: 'codevetter.db',
    database_integrity: rows.integrity,
    probe_nonce: nonce,
    baseline_fingerprint_sha256: baseline?.fingerprint_sha256 ?? fingerprint(expectedHashes),
    fingerprint_sha256: fingerprint(preservedHashes),
    observed_record_count: currentHashes.size,
    preserved_record_count: preservedHashes.length,
    missing_record_count: expectedHashes.length - preservedHashes.length,
    new_record_count: Math.max(0, currentHashes.size - preservedHashes.length),
    table_counts: tableCounts,
    record_hashes: preservedHashes,
    limitations: [
      'Hashes cover durable record identities only; no user content or setting values are read.',
      'The probe is read-only and does not launch, install, migrate, or roll back an application.',
    ],
  };
}

export function compareDataSnapshots(before, afterUpgrade, afterRollback) {
  validateBaseline(before);
  validateFollowup(afterUpgrade, 'after_upgrade', before);
  validateFollowup(afterRollback, 'after_rollback', before);
  if (before.preserved_record_count <= 0) {
    throw new Error('Data continuity requires at least one durable baseline record');
  }
  return {
    schema_version: continuitySchema,
    app_data_identity: productionAppDataIdentity,
    database_filename: 'codevetter.db',
    preserved_record_count: before.preserved_record_count,
    before_sha256: before.fingerprint_sha256,
    after_upgrade_sha256: afterUpgrade.fingerprint_sha256,
    after_rollback_sha256: afterRollback.fingerprint_sha256,
  };
}

function queryDatabase(database) {
  if (!existsSync(sqlite)) throw new Error(`${sqlite} is unavailable`);
  const integrity = runSqlite(database, 'PRAGMA query_only=ON; PRAGMA quick_check;').trim();
  if (integrity !== 'ok') throw new Error(`SQLite quick_check failed: ${integrity || 'no result'}`);
  const tableRows = runJSON(
    database,
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  );
  const available = new Set(tableRows.map((row) => row.name));
  const records = [];
  const tableCounts = {};
  for (const [table, key] of durableIdentityTables) {
    if (!available.has(table)) continue;
    const rows = runJSON(
      database,
      `SELECT CAST("${key}" AS TEXT) AS identity FROM "${table}" WHERE "${key}" IS NOT NULL ORDER BY 1;`
    );
    tableCounts[table] = rows.length;
    for (const row of rows) records.push({ table, identity: String(row.identity) });
  }
  return { integrity, records, tableCounts };
}

function validateBaseline(snapshot) {
  if (
    snapshot?.schema_version !== snapshotSchema ||
    snapshot.phase !== 'before' ||
    snapshot.authority !== 'read_only_identity_probe' ||
    snapshot.app_data_identity !== productionAppDataIdentity ||
    snapshot.database_filename !== 'codevetter.db' ||
    snapshot.database_integrity !== 'ok' ||
    !canonicalSHA256(snapshot.probe_nonce) ||
    !canonicalSHA256(snapshot.fingerprint_sha256) ||
    !Array.isArray(snapshot.record_hashes) ||
    snapshot.record_hashes.some((hash) => !canonicalSHA256(hash)) ||
    snapshot.preserved_record_count !== snapshot.record_hashes.length ||
    snapshot.missing_record_count !== 0 ||
    fingerprint(snapshot.record_hashes) !== snapshot.fingerprint_sha256
  ) {
    throw new Error('Invalid before data snapshot');
  }
}

function validateFollowup(snapshot, phase, before) {
  if (
    snapshot?.schema_version !== snapshotSchema ||
    snapshot.phase !== phase ||
    snapshot.authority !== 'read_only_identity_probe' ||
    snapshot.app_data_identity !== before.app_data_identity ||
    snapshot.database_filename !== before.database_filename ||
    snapshot.database_integrity !== 'ok' ||
    snapshot.probe_nonce !== before.probe_nonce ||
    snapshot.baseline_fingerprint_sha256 !== before.fingerprint_sha256 ||
    snapshot.missing_record_count !== 0 ||
    snapshot.preserved_record_count !== before.preserved_record_count ||
    snapshot.fingerprint_sha256 !== before.fingerprint_sha256 ||
    fingerprint(snapshot.record_hashes) !== snapshot.fingerprint_sha256
  ) {
    throw new Error(`${phase} does not preserve the baseline identity fingerprint`);
  }
}

function runJSON(database, sql) {
  const output = runSqlite(database, sql, ['-json']);
  return output.trim() ? JSON.parse(output) : [];
}

function runSqlite(database, sql, extraArguments = []) {
  const result = spawnSync(sqlite, ['-readonly', ...extraArguments, database, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`Read-only SQLite probe failed: ${(result.stderr ?? '').trim().slice(0, 500)}`);
  }
  return result.stdout ?? '';
}

function recordHash(nonce, table, identity) {
  return sha256(`${nonce}\0${table}\0${identity}`);
}

function fingerprint(hashes) {
  return sha256([...hashes].sort().join('\n'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalSHA256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function requiredValue(argv, index, argument) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
  return value;
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function run(options = parseArguments(process.argv.slice(2))) {
  const receipt =
    options.operation === 'capture'
      ? captureDataSnapshot({
          databasePath: options.database,
          phase: options.phase,
          baseline: options.baseline ? readJSON(options.baseline) : null,
        })
      : compareDataSnapshots(
          readJSON(options.before),
          readJSON(options.afterUpgrade),
          readJSON(options.afterRollback)
        );
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(options.out, output);
  process.stdout.write(output);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) run();
