import assert from 'node:assert/strict';
import test from 'node:test';

import { createUiIncident, formatUiIncidentDiagnostic, recordUiIncident } from './ui-incident';

test('creates a bounded incident without persisting raw error details', () => {
  const incident = createUiIncident({
    error: Object.assign(new Error('token=do-not-store'), { name: 'Render Error!' }),
    scope: 'route',
    route: '/review?private=value#section',
    now: () => new Date('2026-08-16T02:00:00.000Z'),
    randomUuid: () => '00000000-0000-4000-8000-000000000000',
  });
  let stored = '';
  recordUiIncident(incident, { setItem: (_key, value) => (stored = value) });

  assert.deepEqual(incident, {
    schema_version: 1,
    incident_id: 'ui-00000000-0000-4000-8000-000000000000',
    occurred_at: '2026-08-16T02:00:00.000Z',
    scope: 'route',
    route: '/review',
    error_name: 'RenderError',
  });
  assert.equal(stored.includes('do-not-store'), false);
  assert.equal(stored.includes('private=value'), false);
});

test('keeps raw diagnostics ephemeral and explicit', () => {
  const error = new Error('render failed');
  const incident = createUiIncident({
    error,
    scope: 'application',
    route: '/',
    now: () => new Date('2026-08-16T02:00:00.000Z'),
    randomUuid: () => '00000000-0000-4000-8000-000000000000',
  });

  const diagnostic = formatUiIncidentDiagnostic(incident, error, 'at Review');
  assert.match(diagnostic, /Incident: ui-00000000/);
  assert.match(diagnostic, /Error: Error: render failed/);
  assert.match(diagnostic, /Component stack:\nat Review/);
});

test('bounds copied diagnostics and incident identity', () => {
  const error = Object.assign(new Error('x'.repeat(10_000)), {
    stack: 's'.repeat(40_000),
  });
  const incident = createUiIncident({
    error,
    scope: 'application',
    randomUuid: () => '../unsafe/'.repeat(20),
  });
  const diagnostic = formatUiIncidentDiagnostic(incident, error, 'c'.repeat(20_000));

  assert.equal(incident.incident_id.includes('/'), false);
  assert.ok(incident.incident_id.length <= 67);
  assert.ok(diagnostic.length < 37_000);
});
