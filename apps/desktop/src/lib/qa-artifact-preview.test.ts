import assert from 'node:assert/strict';
import test from 'node:test';

import { qaArtifactRenderMode } from './qa-artifact-preview';

const base = {
  runId: 'run-1',
  artifactId: 'artifact-1',
  kind: 'report',
  canonicalPath: '/repo/.codevetter/report.json',
  bytes: 2,
  width: null,
  height: null,
  redacted: true,
  sha256: 'abc',
};

test('renders only inert text and matching image data URLs', () => {
  assert.equal(
    qaArtifactRenderMode({
      ...base,
      contentType: 'application/json',
      text: '{}',
      dataUrl: null,
    }),
    'text'
  );
  assert.equal(
    qaArtifactRenderMode({
      ...base,
      contentType: 'image/png',
      text: null,
      dataUrl: 'data:image/png;base64,AAAA',
    }),
    'image'
  );
});

test('blocks external, executable, and mismatched preview payloads', () => {
  assert.equal(
    qaArtifactRenderMode({
      ...base,
      contentType: 'image/png',
      text: null,
      dataUrl: 'https://example.com/image.png',
    }),
    'unsupported'
  );
  assert.equal(
    qaArtifactRenderMode({
      ...base,
      contentType: 'text/html',
      text: '<script>fetch("/")</script>',
      dataUrl: null,
    }),
    'unsupported'
  );
});
