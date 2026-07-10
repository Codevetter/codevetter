import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCodexFailureEvent,
  parseCodexCliAgentPayload,
  terminalPatchForCodexEvent,
} from './codex-agent-events';

test('parseCodexCliAgentPayload accepts only Codex agent payloads', () => {
  assert.deepEqual(parseCodexCliAgentPayload('{"agent":"codex","event":"stop"}'), {
    agent: 'codex',
    event: 'stop',
  });
  assert.equal(parseCodexCliAgentPayload('{"agent":"claude","event":"stop"}'), null);
  assert.equal(parseCodexCliAgentPayload('not json'), null);
});

test('terminalPatchForCodexEvent marks permission and question events yellow', () => {
  assert.deepEqual(
    terminalPatchForCodexEvent({
      event: 'permission_request',
      summary: 'Allow shell command?',
      session_id: ' sess-1 ',
      transcript_path: ' /tmp/rollout.jsonl ',
    }),
    {
      lastAgentEvent: 'permission_request',
      status: 'yellow',
      updatedAt: 'permission',
      statusReason: 'Allow shell command?',
      idleMs: 0,
      codexSessionId: 'sess-1',
      transcriptPath: '/tmp/rollout.jsonl',
    }
  );

  assert.equal(terminalPatchForCodexEvent({ event: 'question_asked' }).status, 'yellow');
});

test('terminalPatchForCodexEvent marks resume and completion events green', () => {
  assert.deepEqual(terminalPatchForCodexEvent({ event: 'permission_replied' }), {
    lastAgentEvent: 'permission_replied',
    status: 'green',
    updatedAt: 'permission replied',
    statusReason: 'Permission reply sent; Codex resumed',
    idleMs: 0,
  });
  assert.deepEqual(terminalPatchForCodexEvent({ event: 'stop', response: 'Done' }), {
    lastAgentEvent: 'stop',
    status: 'green',
    updatedAt: 'turn done',
    statusReason: 'Done',
    idleMs: 0,
  });
});

test('terminalPatchForCodexEvent marks failures red', () => {
  assert.equal(isCodexFailureEvent('tool_error'), true);
  assert.equal(isCodexFailureEvent('exception'), true);
  assert.equal(isCodexFailureEvent('abort'), true);
  assert.equal(isCodexFailureEvent('tool_complete'), false);
  assert.deepEqual(terminalPatchForCodexEvent({ event: 'tool_error', summary: 'grep failed' }), {
    lastAgentEvent: 'tool_error',
    status: 'red',
    updatedAt: 'failed',
    statusReason: 'grep failed',
    idleMs: 0,
  });
});
