import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyInitialRouteArtifactMovement } from './browser-artifact-verification.mjs';

test('attested initial-route artifacts confirm, reject, and fail closed', () => {
  const subject = (value) => ({ source_snapshot_sha256: value.repeat(64) });
  const artifact = (gzip, verified = true) => ({
    state: 'observed',
    verified,
    total_bytes: gzip * 3,
    total_gzip_bytes: gzip,
    artifact_sha256: 'a'.repeat(64),
  });
  assert.equal(
    verifyInitialRouteArtifactMovement({
      baseline: artifact(149_327),
      current: artifact(115_920),
      baselineSubject: subject('a'),
      currentSubject: subject('b'),
    }).verdict.status,
    'confirmed'
  );
  assert.equal(
    verifyInitialRouteArtifactMovement({
      baseline: artifact(100_000),
      current: artifact(110_000),
      baselineSubject: subject('a'),
      currentSubject: subject('b'),
    }).verdict.status,
    'rejected'
  );
  assert.equal(
    verifyInitialRouteArtifactMovement({
      baseline: artifact(100_000, false),
      current: artifact(80_000),
      baselineSubject: subject('a'),
      currentSubject: subject('b'),
    }).verdict.status,
    'no_confidence'
  );
});
