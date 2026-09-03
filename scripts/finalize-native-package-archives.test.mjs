import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArguments, updateArchiveReceipt } from './finalize-native-package-archives.mjs';

test('final archive hashes replace only the exact qualified archive identities', () => {
  const qualification = {
    schema_version: 'codevetter.native-package-qualification/v1',
    archives: [
      { name: 'CodeVetter-1.11.0-arm64.zip', sha256: 'old-zip' },
      { name: 'CodeVetter-1.11.0-arm64.dmg', sha256: 'old-dmg' },
    ],
  };
  const artifacts = [
    { name: 'CodeVetter-1.11.0-arm64.zip', bytes: 10, sha256: 'new-zip' },
    { name: 'CodeVetter-1.11.0-arm64.dmg', bytes: 20, sha256: 'new-dmg' },
  ];
  const finalized = updateArchiveReceipt(qualification, artifacts);
  assert.deepEqual(finalized.archives, artifacts);
  assert.equal(finalized.notarization_ticket_stapled, true);
  assert.throws(() => updateArchiveReceipt(qualification, artifacts.slice(0, 1)), /do not match/);
});

test('argument parsing requires one qualification receipt', () => {
  assert.equal(
    parseArguments(['--qualification', '/tmp/qualification.json']).qualification,
    '/tmp/qualification.json'
  );
  assert.throws(() => parseArguments([]), /--qualification is required/);
});
