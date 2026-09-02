import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  captureDataSnapshot,
  compareDataSnapshots,
  parseArguments,
} from './qualify-native-data-continuity.mjs';

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-data-continuity-'));
  const appData = join(root, 'com.codevetter.desktop');
  mkdirSync(appData);
  const database = join(appData, 'codevetter.db');
  execFileSync('/usr/bin/sqlite3', [
    database,
    `CREATE TABLE cc_projects(id TEXT PRIMARY KEY, display_name TEXT);
     CREATE TABLE cc_sessions(id TEXT PRIMARY KEY, project_id TEXT, first_message TEXT);
     CREATE TABLE local_reviews(id TEXT PRIMARY KEY, summary_markdown TEXT);
     CREATE TABLE preferences(key TEXT PRIMARY KEY, value TEXT);
     INSERT INTO cc_projects VALUES ('project-1', 'Private project');
     INSERT INTO cc_sessions VALUES ('session-1', 'project-1', 'private message');
     INSERT INTO local_reviews VALUES ('review-1', 'private review');
     INSERT INTO preferences VALUES ('github_token', 'secret-value');`,
  ]);
  try {
    run({ root, database });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('read-only snapshots preserve incumbent identities while allowing new rows', () => {
  withFixture(({ database }) => {
    const before = captureDataSnapshot({
      databasePath: database,
      phase: 'before',
      recordedAt: '2026-09-02T00:00:00.000Z',
      probeNonce: 'a'.repeat(64),
    });
    execFileSync('/usr/bin/sqlite3', [
      database,
      "INSERT INTO cc_sessions VALUES ('session-2', 'project-1', 'new private message');",
    ]);
    const afterUpgrade = captureDataSnapshot({
      databasePath: database,
      phase: 'after_upgrade',
      baseline: before,
      recordedAt: '2026-09-02T00:01:00.000Z',
    });
    execFileSync('/usr/bin/sqlite3', [database, "DELETE FROM cc_sessions WHERE id = 'session-2';"]);
    const afterRollback = captureDataSnapshot({
      databasePath: database,
      phase: 'after_rollback',
      baseline: before,
      recordedAt: '2026-09-02T00:02:00.000Z',
    });

    const continuity = compareDataSnapshots(before, afterUpgrade, afterRollback);
    assert.equal(continuity.schema_version, 'codevetter.native-data-continuity/v1');
    assert.equal(continuity.preserved_record_count, 4);
    assert.equal(continuity.before_sha256, continuity.after_upgrade_sha256);
    assert.equal(continuity.before_sha256, continuity.after_rollback_sha256);
    assert.equal(afterUpgrade.new_record_count, 1);
    assert.equal(JSON.stringify(before).includes('secret-value'), false);
    assert.equal(JSON.stringify(before).includes('private message'), false);
  });
});

test('comparison fails when an incumbent record disappears', () => {
  withFixture(({ database }) => {
    const before = captureDataSnapshot({
      databasePath: database,
      phase: 'before',
      probeNonce: 'b'.repeat(64),
    });
    execFileSync('/usr/bin/sqlite3', [
      database,
      "DELETE FROM local_reviews WHERE id = 'review-1';",
    ]);
    const afterUpgrade = captureDataSnapshot({
      databasePath: database,
      phase: 'after_upgrade',
      baseline: before,
    });
    assert.equal(afterUpgrade.missing_record_count, 1);
    assert.throws(
      () => compareDataSnapshots(before, afterUpgrade, afterUpgrade),
      /after_upgrade does not preserve/
    );
  });
});

test('comparison refuses empty baseline evidence', () => {
  const query = () => ({ integrity: 'ok', records: [], tableCounts: {} });
  withFixture(({ database }) => {
    const before = captureDataSnapshot({
      databasePath: database,
      phase: 'before',
      probeNonce: 'c'.repeat(64),
      query,
    });
    const afterUpgrade = captureDataSnapshot({
      databasePath: database,
      phase: 'after_upgrade',
      baseline: before,
      query,
    });
    const afterRollback = captureDataSnapshot({
      databasePath: database,
      phase: 'after_rollback',
      baseline: before,
      query,
    });
    assert.throws(
      () => compareDataSnapshots(before, afterUpgrade, afterRollback),
      /at least one durable baseline record/
    );
  });
});

test('argument parsing keeps capture and comparison phases explicit', () => {
  const capture = parseArguments([
    'capture',
    '--database',
    '/tmp/codevetter.db',
    '--phase',
    'after_upgrade',
    '--baseline',
    '/tmp/before.json',
    '--out',
    '/tmp/after.json',
  ]);
  assert.equal(capture.phase, 'after_upgrade');
  assert.throws(
    () =>
      parseArguments([
        'capture',
        '--database',
        '/tmp/codevetter.db',
        '--phase',
        'after_upgrade',
        '--out',
        '/tmp/after.json',
      ]),
    /requires --baseline/
  );
  assert.doesNotThrow(() =>
    parseArguments([
      'compare',
      '--before',
      '/tmp/before.json',
      '--after-upgrade',
      '/tmp/upgrade.json',
      '--after-rollback',
      '/tmp/rollback.json',
      '--out',
      '/tmp/continuity.json',
    ])
  );
});
