import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { evaluateNativeAppcast, parseArguments } from './inspect-native-appcast.mjs';

// `generate_appcast` emits the version identities as <item> children; older and
// hand-written feeds put them on the <enclosure>. Both must qualify identically.
function itemLayout({ archiveName, archiveBytes, signature }) {
  return `<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
    <channel>
        <title>CodeVetter</title>
        <item>
            <title>1.11.0</title>
            <sparkle:version>11100</sparkle:version>
            <sparkle:shortVersionString>1.11.0</sparkle:shortVersionString>
            <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
            <enclosure url="https://github.com/Codevetter/codevetter/releases/latest/download/${archiveName}" length="${archiveBytes.length}" type="application/octet-stream" sparkle:edSignature="${signature}"/>
        </item>
    </channel>
</rss>`;
}

function enclosureLayout({ archiveName, archiveBytes, signature }) {
  return `<rss><channel><item><enclosure url="https://github.com/Codevetter/codevetter/releases/latest/download/${archiveName}" sparkle:version="11100" sparkle:shortVersionString="1.11.0" length="${archiveBytes.length}" sparkle:edSignature="${signature}" /></item></channel></rss>`;
}

function fixture(layout = enclosureLayout) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicDER = publicKey.export({ format: 'der', type: 'spki' });
  const rawPublicKey = publicDER.subarray(-32).toString('base64');
  const archiveBytes = Buffer.from('qualified native archive');
  const signature = sign(null, archiveBytes, privateKey).toString('base64');
  const archiveName = 'CodeVetter-1.11.0-arm64.zip';
  const archiveSHA256 = createHash('sha256').update(archiveBytes).digest('hex');
  return {
    xml: layout({ archiveName, archiveBytes, signature }),
    info: {
      CFBundleIdentifier: 'com.codevetter.desktop',
      CFBundleVersion: '11100',
      CFBundleShortVersionString: '1.11.0',
      SUFeedURL: 'https://github.com/Codevetter/codevetter/releases/latest/download/appcast.xml',
      SUPublicEDKey: rawPublicKey,
    },
    qualification: {
      schema_version: 'codevetter.native-package-qualification/v1',
      archives: [{ name: archiveName, bytes: archiveBytes.length, sha256: archiveSHA256 }],
    },
    archiveBytes,
    archiveName,
  };
}

test('exact Sparkle archive signature and identities qualify offline', () => {
  const receipt = evaluateNativeAppcast(fixture());
  assert.equal(receipt.status, 'qualified');
  assert.equal(receipt.qualified, true);
  assert.deepEqual(receipt.blockers, []);
});

test('the generate_appcast item layout qualifies exactly like the enclosure layout', () => {
  const receipt = evaluateNativeAppcast(fixture(itemLayout));
  assert.equal(receipt.status, 'qualified');
  assert.deepEqual(receipt.blockers, []);
  assert.equal(receipt.application.build, '11100');
  assert.equal(receipt.application.version, '1.11.0');
});

test('a feed that disagrees with itself about the version fails closed', () => {
  const input = fixture(itemLayout);
  assert.throws(
    () =>
      evaluateNativeAppcast({
        ...input,
        xml: input.xml.replace('<enclosure url=', '<enclosure sparkle:version="11101" url='),
      }),
    /conflicting sparkle:version/
  );
});

test('a feed missing the version in both placements fails closed', () => {
  const input = fixture(itemLayout);
  assert.throws(
    () =>
      evaluateNativeAppcast({
        ...input,
        xml: input.xml.replace('<sparkle:version>11100</sparkle:version>', ''),
      }),
    /missing sparkle:version/
  );
});

test('tampered archives and mismatched versions fail closed', () => {
  const input = fixture();
  const receipt = evaluateNativeAppcast({
    ...input,
    archiveBytes: Buffer.from('tampered native archive'),
    info: { ...input.info, CFBundleVersion: '11101' },
  });
  assert.equal(receipt.qualified, false);
  assert.deepEqual(
    receipt.checks.filter((item) => !item.passed).map((item) => item.id),
    ['archive_receipt', 'archive_length', 'version', 'signature']
  );
});

test('appcast attributes are decoded exactly once', () => {
  const input = fixture();
  const receipt = evaluateNativeAppcast({
    ...input,
    xml: input.xml.replace(`/${input.archiveName}"`, `/${input.archiveName}?label=a&amp;quot;b"`),
  });

  assert.equal(receipt.qualified, true);
  assert.match(receipt.archive.url, /label=a&quot;b$/);
  assert.doesNotMatch(receipt.archive.url, /%22/);
});

test('argument parsing requires the app, appcast, and qualification', () => {
  const options = parseArguments([
    '--app',
    '/tmp/CodeVetter.app',
    '--appcast',
    '/tmp/appcast.xml',
    '--qualification',
    '/tmp/qualification.json',
    '--out',
    '/tmp/appcast-proof.json',
  ]);
  assert.equal(options.out, '/tmp/appcast-proof.json');
  assert.throws(() => parseArguments(['--app', '/tmp/CodeVetter.app']), /--appcast is required/);
});
