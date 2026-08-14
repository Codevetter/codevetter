export const QUALIFICATION_SCHEMA_VERSION = 'runtime-qualification/v1';
export const PORTFOLIO_MANIFEST_SCHEMA_VERSION = 'runtime-qualification-portfolio-manifest/v1';
export const PORTFOLIO_REPORT_SCHEMA_VERSION = 'runtime-qualification-portfolio/v1';

export const QUALIFICATION_LIMITS = Object.freeze({
  repositories: 64,
  candidates: 24,
  sourceFiles: 500,
  sourceDepth: 6,
  sourceFileBytes: 512 * 1024,
  sourceBytes: 8 * 1024 * 1024,
  manifestBytes: 256 * 1024,
  evidencePerCandidate: 8,
  flagsPerCandidate: 8,
});

export const QUALIFICATION_STATUSES = Object.freeze([
  'ready',
  'needs_selection',
  'no_representative_workload',
  'unsupported',
  'inaccessible',
]);

const PROFILE_ADAPTERS = new Set(['node-test', 'node-script', 'vitest', 'playwright', 'go-bench']);

export function assertPortfolioManifest(value) {
  const errors = validatePortfolioManifest(value);
  if (errors.length > 0) throw new Error(`invalid qualification manifest: ${errors.join('; ')}`);
  return value;
}

export function validatePortfolioManifest(value) {
  const errors = [];
  if (!plainObject(value)) return ['manifest must be an object'];
  closed(value, ['schema_version', 'repositories'], 'manifest', errors);
  if (value.schema_version !== PORTFOLIO_MANIFEST_SCHEMA_VERSION) {
    errors.push('schema_version is invalid');
  }
  if (!Array.isArray(value.repositories) || value.repositories.length === 0) {
    errors.push('repositories must be a non-empty array');
    return errors;
  }
  if (value.repositories.length > QUALIFICATION_LIMITS.repositories) {
    errors.push(`repositories exceeds ${QUALIFICATION_LIMITS.repositories}`);
  }
  const identifiers = new Set();
  value.repositories.forEach((entry, index) => {
    const label = `repositories[${index}]`;
    if (!plainObject(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    closed(entry, ['id', 'path'], label, errors);
    if (typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(entry.id)) {
      errors.push(`${label}.id is invalid`);
    } else if (identifiers.has(entry.id)) {
      errors.push(`${label}.id is duplicated`);
    } else {
      identifiers.add(entry.id);
    }
    if (
      typeof entry.path !== 'string' ||
      entry.path.length === 0 ||
      entry.path.length > 2_000 ||
      entry.path.includes('\0')
    ) {
      errors.push(`${label}.path is invalid`);
    }
  });
  return errors;
}

export function assertQualification(value) {
  const errors = validateQualification(value);
  if (errors.length > 0) throw new Error(`invalid runtime qualification: ${errors.join('; ')}`);
  return value;
}

export function validateQualification(value) {
  const errors = [];
  if (!plainObject(value)) return ['qualification must be an object'];
  if (value.schema_version !== QUALIFICATION_SCHEMA_VERSION) errors.push('invalid schema_version');
  if (!QUALIFICATION_STATUSES.includes(value.status)) errors.push('invalid status');
  if (!plainObject(value.subject)) errors.push('subject must be an object');
  if (!Array.isArray(value.lanes)) errors.push('lanes must be an array');
  if (!Array.isArray(value.candidates)) errors.push('candidates must be an array');
  if (value.candidates?.length > QUALIFICATION_LIMITS.candidates) {
    errors.push('candidates exceed bound');
  }
  for (const [index, candidate] of (value.candidates ?? []).entries()) {
    validateCandidate(candidate, `candidates[${index}]`, errors);
  }
  if (value.recommended !== null) validateRecipe(value.recommended, 'recommended', errors);
  if (!plainObject(value.next_action) || typeof value.next_action.kind !== 'string') {
    errors.push('next_action is invalid');
  }
  if (!Array.isArray(value.limitations)) errors.push('limitations must be an array');
  if (!plainObject(value.scan)) errors.push('scan must be an object');
  return errors;
}

export function assertPortfolioReport(value) {
  const errors = validatePortfolioReport(value);
  if (errors.length > 0) throw new Error(`invalid portfolio qualification: ${errors.join('; ')}`);
  return value;
}

export function validatePortfolioReport(value) {
  const errors = [];
  if (!plainObject(value)) return ['report must be an object'];
  if (value.schema_version !== PORTFOLIO_REPORT_SCHEMA_VERSION) {
    errors.push('invalid schema_version');
  }
  if (typeof value.manifest_digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.manifest_digest)) {
    errors.push('manifest_digest is invalid');
  }
  if (!Array.isArray(value.repositories)) {
    errors.push('repositories must be an array');
  } else {
    for (const [index, entry] of value.repositories.entries()) {
      if (!plainObject(entry) || typeof entry.repository_id !== 'string') {
        errors.push(`repositories[${index}] is invalid`);
        continue;
      }
      const { repository_id: _repositoryId, ...qualification } = entry;
      errors.push(
        ...validateQualification(qualification).map((error) => `repositories[${index}].${error}`)
      );
    }
  }
  if (!plainObject(value.summary)) errors.push('summary must be an object');
  if (!Array.isArray(value.limitations)) errors.push('limitations must be an array');
  return errors;
}

function validateCandidate(value, label, errors) {
  if (!plainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof value.id !== 'string' || value.id.length === 0) errors.push(`${label}.id is invalid`);
  if (!PROFILE_ADAPTERS.has(value.adapter)) errors.push(`${label}.adapter is invalid`);
  if (typeof value.target !== 'string' || value.target.length === 0) {
    errors.push(`${label}.target is invalid`);
  }
  if (value.name !== null && (typeof value.name !== 'string' || value.name.length === 0)) {
    errors.push(`${label}.name is invalid`);
  }
  if (typeof value.package_scope !== 'string') errors.push(`${label}.package_scope is invalid`);
  if (!Number.isInteger(value.score) || value.score < 0 || value.score > 100) {
    errors.push(`${label}.score is invalid`);
  }
  if (!Array.isArray(value.signals)) errors.push(`${label}.signals must be an array`);
  if (!Array.isArray(value.safety_flags)) errors.push(`${label}.safety_flags must be an array`);
  if (!Array.isArray(value.evidence)) errors.push(`${label}.evidence must be an array`);
}

function validateRecipe(value, label, errors) {
  if (!plainObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!PROFILE_ADAPTERS.has(value.adapter)) errors.push(`${label}.adapter is invalid`);
  if (typeof value.target !== 'string' || value.target.length === 0) {
    errors.push(`${label}.target is invalid`);
  }
  if (value.name !== null && typeof value.name !== 'string')
    errors.push(`${label}.name is invalid`);
  if (!Number.isInteger(value.samples) || value.samples < 2 || value.samples > 10) {
    errors.push(`${label}.samples is invalid`);
  }
  if (!Number.isInteger(value.warmups) || value.warmups < 0 || value.warmups > 5) {
    errors.push(`${label}.warmups is invalid`);
  }
  if (!Number.isInteger(value.timeout_ms) || value.timeout_ms < 100 || value.timeout_ms > 120_000) {
    errors.push(`${label}.timeout_ms is invalid`);
  }
}

function closed(value, allowed, label, errors) {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) errors.push(`${label} has unknown field: ${unknown.join(', ')}`);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
