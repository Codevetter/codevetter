import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNativeNotarizationProof,
  parseArguments,
} from './create-native-notarization-proof.mjs';

const input = () => ({
  submission: { id: 'submission-1', status: 'Accepted' },
  archiveSHA256: 'a'.repeat(64),
  qualification: { archives: [{ sha256: 'a'.repeat(64) }] },
  stapleValidated: true,
  recordedAt: '2026-09-02T00:00:00.000Z',
});

test('accepted submission and validated staple produce an archive-bound proof', () => {
  const proof = buildNativeNotarizationProof(input());
  assert.equal(proof.status, 'accepted');
  assert.equal(proof.stapled, true);
  assert.equal(proof.archive_sha256, 'a'.repeat(64));
});

test('rejected, unbound, and unstapled evidence fail closed', () => {
  assert.throws(
    () => buildNativeNotarizationProof({ ...input(), submission: { status: 'Invalid' } }),
    /not accepted/
  );
  assert.throws(
    () =>
      buildNativeNotarizationProof({
        ...input(),
        archiveSHA256: 'b'.repeat(64),
      }),
    /not bound/
  );
  assert.throws(
    () => buildNativeNotarizationProof({ ...input(), stapleValidated: false }),
    /not stapled/
  );
});

test('argument parsing requires every local evidence input', () => {
  const options = parseArguments([
    '--app',
    '/tmp/CodeVetter.app',
    '--archive',
    '/tmp/CodeVetter.zip',
    '--qualification',
    '/tmp/qualification.json',
    '--submission',
    '/tmp/submission.json',
    '--out',
    '/tmp/notarization.json',
  ]);
  assert.equal(options.out, '/tmp/notarization.json');
  assert.throws(() => parseArguments([]), /--app is required/);
});
