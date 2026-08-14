import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { repositoryRelative } from './contracts.mjs';
import { assertPerformanceLabCorrectnessScope } from './performance-lab-contracts.mjs';

export const PERFORMANCE_FLOW_CONTRACT_FILE = 'codevetter.performance.json';
export const PERFORMANCE_FLOW_CONTRACT_SCHEMA_VERSION = 'codevetter-performance-flows/v1';
export const PERFORMANCE_FLOW_CONTRACT_LIMITS = Object.freeze({
  bytes: 64 * 1024,
  flows: 32,
  sourcesPerFlow: 16,
  text: 1_000,
});

const PERFORMANCE_ADAPTERS = new Set(['node-test', 'node-script', 'vitest', 'jest', 'go-bench']);

export async function loadPerformanceFlowContract(repositoryRoot) {
  const root = await realpath(resolve(repositoryRoot));
  const lexicalPath = resolve(root, PERFORMANCE_FLOW_CONTRACT_FILE);
  let metadata;
  try {
    metadata = await lstat(lexicalPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { present: false, manifest_sha256: null, bindings: [] };
    }
    throw new Error('performance flow contract metadata is unavailable');
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('performance flow contract must be a regular non-symlink file');
  }
  if (metadata.size < 1 || metadata.size > PERFORMANCE_FLOW_CONTRACT_LIMITS.bytes) {
    throw new Error('performance flow contract exceeds its byte bound');
  }
  const path = await realpath(lexicalPath);
  if (repositoryRelative(root, path) !== PERFORMANCE_FLOW_CONTRACT_FILE) {
    throw new Error('performance flow contract escapes the repository root');
  }
  const source = await readFile(path, 'utf8');
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('performance flow contract is not valid JSON');
  }
  const contract = assertPerformanceFlowContract(value);
  const manifestSha256 = createHash('sha256').update(source).digest('hex');
  return {
    present: true,
    manifest_sha256: manifestSha256,
    bindings: contract.flows.map((binding) => ({
      ...binding,
      manifest_sha256: manifestSha256,
    })),
  };
}

export function assertPerformanceFlowContract(value) {
  const errors = validatePerformanceFlowContract(value);
  if (errors.length > 0) {
    throw new Error(`invalid performance flow contract: ${errors.join('; ')}`);
  }
  return value;
}

export function validatePerformanceFlowContract(value) {
  if (!plain(value)) return ['contract must be an object'];
  const errors = [];
  closed(value, ['schema_version', 'flows'], 'contract', errors);
  if (value.schema_version !== PERFORMANCE_FLOW_CONTRACT_SCHEMA_VERSION) {
    errors.push('schema_version is invalid');
  }
  if (!Array.isArray(value.flows) || value.flows.length === 0) {
    errors.push('flows must be a non-empty array');
    return errors;
  }
  if (value.flows.length > PERFORMANCE_FLOW_CONTRACT_LIMITS.flows) {
    errors.push(`flows exceeds ${PERFORMANCE_FLOW_CONTRACT_LIMITS.flows}`);
  }
  const identities = new Set();
  for (const [index, binding] of value.flows.entries()) {
    const label = `flows[${index}]`;
    if (!plain(binding)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    closed(binding, ['performance', 'correctness', 'sources'], label, errors);
    validatePerformanceIdentity(binding.performance, `${label}.performance`, errors);
    try {
      assertPerformanceLabCorrectnessScope(binding.correctness);
    } catch (error) {
      errors.push(`${label}.${error.message}`);
    }
    if (binding.sources !== undefined) {
      if (
        !Array.isArray(binding.sources) ||
        binding.sources.length === 0 ||
        binding.sources.length > PERFORMANCE_FLOW_CONTRACT_LIMITS.sourcesPerFlow
      ) {
        errors.push(
          `${label}.sources must contain 1 to ${PERFORMANCE_FLOW_CONTRACT_LIMITS.sourcesPerFlow} exact files`
        );
      } else {
        const sources = new Set();
        for (const source of binding.sources) {
          if (!safePath(source)) errors.push(`${label}.sources must contain exact relative files`);
          if (sources.has(source)) errors.push(`${label}.sources contains a duplicate file`);
          sources.add(source);
        }
      }
    }
    if (plain(binding.performance)) {
      const identity = performanceFlowIdentity(binding.performance);
      if (identities.has(identity)) errors.push(`${label}.performance is duplicated`);
      identities.add(identity);
    }
  }
  return [...new Set(errors)];
}

export function resolveSourceOwnedPerformanceBindings(contract, changedFiles) {
  const changed = new Set(changedFiles);
  return contract.bindings
    .filter(
      (binding) =>
        Array.isArray(binding.sources) && binding.sources.some((source) => changed.has(source))
    )
    .toSorted((left, right) =>
      performanceFlowIdentity(left.performance).localeCompare(
        performanceFlowIdentity(right.performance)
      )
    );
}

export function contractOwnsCorrectnessScope(contract, scope) {
  return contract.bindings.some(
    (binding) =>
      binding.correctness.adapter === scope.adapter &&
      binding.correctness.target === scope.target &&
      binding.correctness.name === scope.name
  );
}

export function contractOwnsReviewBinding(
  contract,
  { source, performanceScope, correctnessScope }
) {
  return contract.bindings.some(
    (binding) =>
      binding.sources?.includes(source) &&
      performanceFlowIdentity(binding.performance) === performanceFlowIdentity(performanceScope) &&
      binding.correctness.adapter === correctnessScope.adapter &&
      binding.correctness.target === correctnessScope.target &&
      binding.correctness.name === correctnessScope.name
  );
}

export function assertPerformanceFlowScope(value) {
  const errors = [];
  validatePerformanceIdentity(value, 'performance scope', errors);
  if (errors.length > 0) {
    throw new Error(`invalid performance flow scope: ${[...new Set(errors)].join('; ')}`);
  }
  return value;
}

export function resolvePerformanceFlowBinding(contract, flow) {
  const identity = performanceFlowIdentity(flow);
  return (
    contract.bindings.find(
      (binding) => performanceFlowIdentity(binding.performance) === identity
    ) ?? null
  );
}

export function performanceFlowIdentity(value) {
  return `${value?.adapter ?? ''}\0${value?.target ?? ''}\0${value?.name ?? ''}`;
}

function validatePerformanceIdentity(value, label, errors) {
  if (!plain(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  closed(value, ['adapter', 'target', 'name'], label, errors);
  if (!PERFORMANCE_ADAPTERS.has(value.adapter)) errors.push(`${label}.adapter is unsupported`);
  if (!safePath(value.target)) errors.push(`${label}.target must be a contained relative path`);
  const validName =
    typeof value.name === 'string'
      ? value.name.length > 0 &&
        value.name.length <= PERFORMANCE_FLOW_CONTRACT_LIMITS.text &&
        !value.name.includes('\0')
      : value.name === null && value.adapter === 'node-script';
  if (!validName) errors.push(`${label}.name must identify one exact workload`);
}

function safePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PERFORMANCE_FLOW_CONTRACT_LIMITS.text &&
    !value.includes('\0') &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    !value.split('/').some((part) => part === '' || part === '.' || part === '..')
  );
}

function closed(value, allowed, label, errors) {
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) errors.push(`${label} has unknown field: ${unknown.join(', ')}`);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
