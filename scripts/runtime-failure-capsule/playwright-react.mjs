import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLAYWRIGHT_REACT_SCHEMA_VERSION = 'runtime-playwright-react-commits/v2';
const LEGACY_PLAYWRIGHT_REACT_SCHEMA_VERSION = 'runtime-playwright-react-commits/v1';
const REACT_DOCUMENT_SCHEMA_VERSION = 'runtime-playwright-react-document/v2';
const LEGACY_REACT_DOCUMENT_SCHEMA_VERSION = 'runtime-playwright-react-document/v1';
const SELF_DURATION_PROVENANCE = 'inclusive_minus_direct_child_actual_duration';
export const PLAYWRIGHT_REACT_BINDING = '__codevetterReportReact_8f3c2a1d';
export const PLAYWRIGHT_REACT_LIMITS = Object.freeze({
  documents: 8,
  files: 16,
  rawBytes: 64 * 1024,
  renderers: 8,
  commits: 128,
  components: 64,
  reportedComponents: 16,
  fibersPerCommit: 10_000,
  componentNameCharacters: 120,
});

const LOADER_PATH = fileURLToPath(new URL('./playwright-react-loader.mjs', import.meta.url));
const PRELOAD_PATH = fileURLToPath(new URL('./playwright-react-preload.cjs', import.meta.url));
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export async function findDeclaredReactAuthority(repositoryRoot, target) {
  const root = resolve(repositoryRoot);
  let current = dirname(resolve(root, target));
  while (current === root || current.startsWith(`${root}/`)) {
    const manifestPath = join(current, 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const declared = DEPENDENCY_FIELDS.flatMap((field) =>
        Object.keys(manifest?.[field] ?? {}).filter(
          (name) => name === 'react' || name === 'react-dom'
        )
      ).toSorted();
      if (declared.length > 0) {
        return {
          package_path: relative(root, manifestPath).replaceAll('\\', '/'),
          declared_packages: [...new Set(declared)],
          provenance: 'nearest_package_manifest_declared_dependency',
        };
      }
    } catch {
      // Keep walking toward the repository root; absent or malformed manifests do not imply React.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function playwrightReactEnvironment({ repositoryRoot, target, outputDirectory }) {
  return {
    NODE_OPTIONS: [
      `--experimental-loader=${JSON.stringify(LOADER_PATH)}`,
      `--require=${JSON.stringify(PRELOAD_PATH)}`,
    ].join(' '),
    CODEVETTER_REPOSITORY_ROOT: repositoryRoot,
    CODEVETTER_PLAYWRIGHT_TARGET: target,
    CODEVETTER_BROWSER_REACT_DIRECTORY: outputDirectory,
  };
}

export async function collectPlaywrightReactEvidence(
  directory,
  authority,
  { componentLimit = PLAYWRIGHT_REACT_LIMITS.reportedComponents } = {}
) {
  if (
    !Number.isSafeInteger(componentLimit) ||
    componentLimit < 1 ||
    componentLimit > PLAYWRIGHT_REACT_LIMITS.components
  ) {
    throw new Error('Playwright React component projection bound is invalid');
  }
  if (!authority)
    return unavailablePlaywrightReactEvidence(null, 'No declared React authority was found.');
  let entries;
  try {
    entries = (await readdir(directory)).filter((entry) => entry.endsWith('.json')).toSorted();
  } catch {
    return unavailablePlaywrightReactEvidence(
      authority,
      'The React diagnostic pass emitted no evidence directory.'
    );
  }
  if (entries.length > PLAYWRIGHT_REACT_LIMITS.files) {
    return unavailablePlaywrightReactEvidence(
      authority,
      'The React diagnostic evidence inventory exceeded its bound.'
    );
  }
  let lifecycle = null;
  if (entries.includes('lifecycle.json')) {
    try {
      const bytes = await readFile(join(directory, 'lifecycle.json'));
      if (bytes.byteLength <= 8 * 1024) lifecycle = normalizeReactLifecycle(JSON.parse(bytes));
    } catch {
      // Malformed lifecycle evidence cannot upgrade missing documents to a successful capture.
    }
  }
  const documents = [];
  for (const entry of entries
    .filter((name) => /^document-[0-7]\.json$/.test(name))
    .slice(0, PLAYWRIGHT_REACT_LIMITS.documents)) {
    try {
      const bytes = await readFile(join(directory, entry));
      if (bytes.byteLength > PLAYWRIGHT_REACT_LIMITS.rawBytes) continue;
      documents.push(sanitizePlaywrightReactDocument(JSON.parse(bytes)));
    } catch {
      // Malformed or oversized page evidence is omitted and remains visible through the final state.
    }
  }
  if (documents.length === 0) {
    return unavailablePlaywrightReactEvidence(authority, lifecycleReason(lifecycle), lifecycle);
  }
  return aggregateDocuments(authority, documents, lifecycle, componentLimit);
}

export async function attributePlaywrightReactComponents(repositoryRoot, value) {
  const evidence = normalizePlaywrightReactEvidence(value, {
    componentLimit: PLAYWRIGHT_REACT_LIMITS.components,
  });
  if (!evidence || evidence.components.length === 0) return evidence;
  const root = resolve(repositoryRoot);
  const names = new Set(evidence.components.map((component) => component.name));
  const declarations = new Map([...names].map((name) => [name, []]));
  const queue = [root];
  let files = 0;
  let bytes = 0;
  let sourceScanComplete = true;
  while (queue.length > 0 && files < 512 && bytes < 4 * 1024 * 1024) {
    const directory = queue.shift();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      sourceScanComplete = false;
      continue;
    }
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.') || SOURCE_EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        queue.push(path);
        continue;
      }
      if (!entry.isFile() || !/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) continue;
      if (files >= 512 || bytes >= 4 * 1024 * 1024) {
        sourceScanComplete = false;
        break;
      }
      let metadata;
      try {
        metadata = await stat(path);
      } catch {
        sourceScanComplete = false;
        continue;
      }
      if (!metadata.isFile()) continue;
      if (metadata.size > 256 * 1024 || bytes + metadata.size > 4 * 1024 * 1024) {
        sourceScanComplete = false;
        continue;
      }
      files += 1;
      bytes += metadata.size;
      let source;
      try {
        source = await readFile(path, 'utf8');
      } catch {
        sourceScanComplete = false;
        continue;
      }
      const relativePath = relative(root, path).replaceAll('\\', '/');
      for (const name of names) {
        const matches = declarations.get(name);
        if (matches.length > 1) continue;
        const declaration = componentDeclaration(source, name);
        if (declaration !== null) matches.push({ file: relativePath, line: declaration });
      }
    }
  }
  if (queue.length > 0) sourceScanComplete = false;
  const components = evidence.components.map((component) => {
    const matches = declarations.get(component.name);
    return sourceScanComplete && matches.length === 1
      ? {
          ...component,
          ownership: 'repository',
          source: {
            ...matches[0],
            provenance: 'static_unique_react_component_declaration',
          },
        }
      : { ...component, ownership: 'external_or_ambiguous', source: null };
  });
  const modern = evidence.schema_version === PLAYWRIGHT_REACT_SCHEMA_VERSION;
  return normalizePlaywrightReactEvidence({
    ...evidence,
    components: components
      .toSorted(
        (left, right) =>
          Number(right.ownership === 'repository') - Number(left.ownership === 'repository') ||
          (modern
            ? right.self_actual_duration_ms - left.self_actual_duration_ms
            : right.inclusive_actual_duration_ms - left.inclusive_actual_duration_ms) ||
          left.name.localeCompare(right.name)
      )
      .slice(0, PLAYWRIGHT_REACT_LIMITS.reportedComponents),
    truncated: evidence.truncated || components.length > PLAYWRIGHT_REACT_LIMITS.reportedComponents,
    ...(modern
      ? {
          presentation_truncated:
            evidence.presentation_truncated ||
            components.length > PLAYWRIGHT_REACT_LIMITS.reportedComponents,
          source_attribution: {
            state: sourceScanComplete ? 'complete' : 'partial',
            files_scanned: files,
            bytes_scanned: bytes,
            file_limit: 512,
            byte_limit: 4 * 1024 * 1024,
            provenance: 'bounded_static_component_declaration_scan',
          },
        }
      : {}),
    limitations: [
      ...evidence.limitations,
      'Repository ownership requires one bounded static component declaration match; ambiguous and framework components are not optimization candidates.',
      ...(!sourceScanComplete
        ? [
            'The bounded repository source scan was incomplete, so no component received unique-source experiment authority.',
          ]
        : []),
    ].slice(0, 8),
  });
}

export function normalizePlaywrightReactEvidence(
  value,
  { componentLimit = PLAYWRIGHT_REACT_LIMITS.reportedComponents } = {}
) {
  if (value === null) return null;
  const allowed = [
    'schema_version',
    'state',
    'framework',
    'authority',
    'documents_observed',
    'renderer_versions',
    'commit_count',
    'profiled_commit_count',
    'total_actual_duration_ms',
    'max_commit_duration_ms',
    'measurement_complete',
    'presentation_truncated',
    'self_duration_provenance',
    'source_attribution',
    'components',
    'attribution',
    'truncated',
    'provenance',
    'delivery',
    'limitations',
  ];
  if (
    !plainObject(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    ![PLAYWRIGHT_REACT_SCHEMA_VERSION, LEGACY_PLAYWRIGHT_REACT_SCHEMA_VERSION].includes(
      value.schema_version
    ) ||
    !['succeeded', 'not_detected', 'unavailable'].includes(value.state) ||
    value.framework !== 'react' ||
    !validAuthority(value.authority) ||
    !boundedInteger(value.documents_observed, 0, PLAYWRIGHT_REACT_LIMITS.documents) ||
    !Array.isArray(value.renderer_versions) ||
    value.renderer_versions.length > PLAYWRIGHT_REACT_LIMITS.renderers ||
    value.renderer_versions.some((entry) => typeof entry !== 'string' || entry.length > 80) ||
    !boundedInteger(
      value.commit_count,
      0,
      PLAYWRIGHT_REACT_LIMITS.documents * PLAYWRIGHT_REACT_LIMITS.commits
    ) ||
    !boundedInteger(
      value.profiled_commit_count,
      0,
      PLAYWRIGHT_REACT_LIMITS.documents * PLAYWRIGHT_REACT_LIMITS.commits
    ) ||
    value.profiled_commit_count > value.commit_count ||
    !boundedDuration(value.total_actual_duration_ms) ||
    !boundedDuration(value.max_commit_duration_ms) ||
    !Array.isArray(value.components) ||
    !Number.isSafeInteger(componentLimit) ||
    componentLimit < 1 ||
    componentLimit > PLAYWRIGHT_REACT_LIMITS.components ||
    value.components.length > componentLimit ||
    !['component_activity_observed', 'commit_only', 'not_detected', 'unavailable'].includes(
      value.attribution
    ) ||
    typeof value.truncated !== 'boolean' ||
    value.provenance !== 'react_devtools_hook_separate_exact_flow_pass' ||
    !validDelivery(value.delivery) ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 8 ||
    value.limitations.some((entry) => typeof entry !== 'string' || entry.length > 500)
  ) {
    throw new Error('Playwright React evidence is invalid');
  }
  const modern = value.schema_version === PLAYWRIGHT_REACT_SCHEMA_VERSION;
  if (
    modern &&
    (typeof value.measurement_complete !== 'boolean' ||
      typeof value.presentation_truncated !== 'boolean' ||
      value.self_duration_provenance !== SELF_DURATION_PROVENANCE ||
      !validSourceAttribution(value.source_attribution))
  ) {
    throw new Error('Playwright React evidence is invalid');
  }
  const components = value.components.map((component) =>
    normalizeComponent(component, { requireSelfDuration: modern })
  );
  if (
    new Set(value.renderer_versions).size !== value.renderer_versions.length ||
    new Set(components.map((entry) => entry.name)).size !== components.length ||
    (value.state === 'succeeded' && value.commit_count < 1) ||
    (value.attribution === 'component_activity_observed' && components.length < 1) ||
    (value.state === 'unavailable' && value.attribution !== 'unavailable')
  ) {
    throw new Error('Playwright React evidence is inconsistent');
  }
  return {
    ...value,
    renderer_versions: [...value.renderer_versions],
    components,
    limitations: [...value.limitations],
  };
}

export function unavailablePlaywrightReactEvidence(authority, limitation, lifecycle = null) {
  return {
    schema_version: PLAYWRIGHT_REACT_SCHEMA_VERSION,
    state: 'unavailable',
    framework: 'react',
    authority,
    documents_observed: 0,
    renderer_versions: [],
    commit_count: 0,
    profiled_commit_count: 0,
    total_actual_duration_ms: 0,
    max_commit_duration_ms: 0,
    measurement_complete: false,
    presentation_truncated: false,
    self_duration_provenance: SELF_DURATION_PROVENANCE,
    source_attribution: null,
    components: [],
    attribution: 'unavailable',
    truncated: false,
    provenance: 'react_devtools_hook_separate_exact_flow_pass',
    delivery: compactDelivery(lifecycle),
    limitations: [limitation.slice(0, 500)],
  };
}

export function sanitizePlaywrightReactDocument(value) {
  const modern = value?.schema_version === REACT_DOCUMENT_SCHEMA_VERSION;
  if (
    !plainObject(value) ||
    ![REACT_DOCUMENT_SCHEMA_VERSION, LEGACY_REACT_DOCUMENT_SCHEMA_VERSION].includes(
      value.schema_version
    ) ||
    !['installed', 'existing_hook'].includes(value.hook_state) ||
    !Array.isArray(value.renderer_versions) ||
    value.renderer_versions.length > PLAYWRIGHT_REACT_LIMITS.renderers ||
    value.renderer_versions.some((entry) => typeof entry !== 'string' || entry.length > 80) ||
    !boundedInteger(value.commit_count, 0, PLAYWRIGHT_REACT_LIMITS.commits) ||
    !boundedInteger(value.profiled_commit_count, 0, PLAYWRIGHT_REACT_LIMITS.commits) ||
    value.profiled_commit_count > value.commit_count ||
    !boundedDuration(value.total_actual_duration_ms) ||
    !boundedDuration(value.max_commit_duration_ms) ||
    !Array.isArray(value.components) ||
    value.components.length > PLAYWRIGHT_REACT_LIMITS.components ||
    typeof value.truncated !== 'boolean' ||
    (modern &&
      (typeof value.measurement_complete !== 'boolean' ||
        typeof value.presentation_truncated !== 'boolean' ||
        value.self_duration_provenance !== SELF_DURATION_PROVENANCE))
  ) {
    throw new Error('raw Playwright React document is invalid');
  }
  return {
    schema_version: value.schema_version,
    hook_state: value.hook_state,
    document_token: canonicalDocumentToken(value.document_token) ? value.document_token : null,
    renderer_versions: [...new Set(value.renderer_versions)].slice(
      0,
      PLAYWRIGHT_REACT_LIMITS.renderers
    ),
    commit_count: value.commit_count,
    profiled_commit_count: value.profiled_commit_count,
    total_actual_duration_ms: round3(value.total_actual_duration_ms),
    max_commit_duration_ms: round3(value.max_commit_duration_ms),
    components: value.components.map((component) =>
      normalizeComponent(component, { requireSelfDuration: modern })
    ),
    truncated: value.truncated,
    ...(modern
      ? {
          measurement_complete: value.measurement_complete,
          presentation_truncated: value.presentation_truncated,
          self_duration_provenance: value.self_duration_provenance,
        }
      : {}),
  };
}

function aggregateDocuments(authority, documents, lifecycle, componentLimit) {
  const modern = documents.every(
    (document) => document.schema_version === REACT_DOCUMENT_SCHEMA_VERSION
  );
  const renderers = new Set();
  const components = new Map();
  let commitCount = 0;
  let profiledCommitCount = 0;
  let totalActualDuration = 0;
  let maxCommitDuration = 0;
  let measurementComplete = modern;
  let presentationTruncated = documents.length >= PLAYWRIGHT_REACT_LIMITS.documents;
  let installedDocuments = 0;
  for (const document of documents) {
    if (document.hook_state !== 'installed') continue;
    installedDocuments += 1;
    for (const version of document.renderer_versions) renderers.add(version);
    commitCount += document.commit_count;
    profiledCommitCount += document.profiled_commit_count;
    totalActualDuration += document.total_actual_duration_ms;
    maxCommitDuration = Math.max(maxCommitDuration, document.max_commit_duration_ms);
    if (modern) {
      measurementComplete &&= document.measurement_complete;
      presentationTruncated ||= document.presentation_truncated;
    }
    for (const component of document.components) {
      const current = components.get(component.name) ?? {
        name: component.name,
        active_fiber_count: 0,
        commits_present: 0,
        inclusive_actual_duration_ms: 0,
        max_actual_duration_ms: 0,
        ...(modern ? { self_actual_duration_ms: 0, max_self_actual_duration_ms: 0 } : {}),
      };
      current.active_fiber_count += component.active_fiber_count;
      current.commits_present += component.commits_present;
      current.inclusive_actual_duration_ms += component.inclusive_actual_duration_ms;
      current.max_actual_duration_ms = Math.max(
        current.max_actual_duration_ms,
        component.max_actual_duration_ms
      );
      if (modern) {
        current.self_actual_duration_ms += component.self_actual_duration_ms;
        current.max_self_actual_duration_ms = Math.max(
          current.max_self_actual_duration_ms,
          component.max_self_actual_duration_ms
        );
      }
      components.set(component.name, current);
    }
  }
  const ranked = [...components.values()]
    .map((component) => roundComponent(component, { includeSelfDuration: modern }))
    .toSorted(
      (left, right) =>
        (modern
          ? right.self_actual_duration_ms - left.self_actual_duration_ms
          : right.inclusive_actual_duration_ms - left.inclusive_actual_duration_ms) ||
        right.commits_present - left.commits_present ||
        left.name.localeCompare(right.name)
    );
  presentationTruncated ||= ranked.length > componentLimit;
  const state = commitCount > 0 ? 'succeeded' : 'not_detected';
  const attribution =
    profiledCommitCount > 0 && ranked.length > 0
      ? 'component_activity_observed'
      : commitCount > 0
        ? 'commit_only'
        : 'not_detected';
  return normalizePlaywrightReactEvidence(
    {
      schema_version: modern
        ? PLAYWRIGHT_REACT_SCHEMA_VERSION
        : LEGACY_PLAYWRIGHT_REACT_SCHEMA_VERSION,
      state,
      framework: 'react',
      authority,
      documents_observed: installedDocuments,
      renderer_versions: [...renderers].slice(0, PLAYWRIGHT_REACT_LIMITS.renderers).toSorted(),
      commit_count: commitCount,
      profiled_commit_count: profiledCommitCount,
      total_actual_duration_ms: round3(totalActualDuration),
      max_commit_duration_ms: round3(maxCommitDuration),
      ...(modern
        ? {
            measurement_complete: measurementComplete,
            presentation_truncated: presentationTruncated,
            self_duration_provenance: SELF_DURATION_PROVENANCE,
            source_attribution: null,
          }
        : {}),
      components: ranked.slice(0, componentLimit),
      attribution,
      truncated: modern
        ? !measurementComplete || presentationTruncated
        : documents.some((document) => document.truncated) || presentationTruncated,
      provenance: 'react_devtools_hook_separate_exact_flow_pass',
      delivery: compactDelivery(lifecycle),
      limitations: [
        'React commit timing is collected in a separate diagnostic rerun and is not the authoritative flow benchmark.',
        ...(profiledCommitCount === 0 && commitCount > 0
          ? ['The active React renderer exposed commits but no positive profiling duration.']
          : []),
        ...(documents.some((document) => document.hook_state === 'existing_hook')
          ? ['At least one live document already had a React DevTools hook and was not modified.']
          : []),
        ...(lifecycle?.documents_delivered > 0
          ? ['Document telemetry was delivered during the separate diagnostic lifetime.']
          : ['Only final live-document fallback evidence was available.']),
        'Component durations are inclusive React fiber observations, not exclusive CPU attribution.',
        ...(modern
          ? [
              'Component self duration is derived from inclusive duration minus direct-child duration and is not exact exclusive JavaScript CPU.',
            ]
          : ['Legacy React evidence exposes no derived component self duration.']),
      ],
    },
    { componentLimit }
  );
}

function normalizeReactLifecycle(value) {
  if (
    !plainObject(value) ||
    value.schema_version !== 'runtime-playwright-react-lifecycle/v1' ||
    value.fixture_started !== true ||
    !['installed', 'unavailable'].includes(value.binding_state) ||
    !boundedInteger(value.binding_calls, 0, 256) ||
    !boundedInteger(value.invalid_payloads, 0, 256) ||
    !boundedInteger(value.documents_delivered, 0, PLAYWRIGHT_REACT_LIMITS.documents) ||
    !boundedInteger(value.fallback_pages_evaluated, 0, PLAYWRIGHT_REACT_LIMITS.documents) ||
    typeof value.truncated !== 'boolean' ||
    value.completed !== true
  ) {
    throw new Error('Playwright React lifecycle evidence is invalid');
  }
  return {
    schema_version: value.schema_version,
    fixture_started: true,
    binding_state: value.binding_state,
    binding_calls: value.binding_calls,
    invalid_payloads: value.invalid_payloads,
    documents_delivered: value.documents_delivered,
    fallback_pages_evaluated: value.fallback_pages_evaluated,
    truncated: value.truncated,
    completed: true,
  };
}

function compactDelivery(value) {
  if (!value) return null;
  return {
    binding_state: value.binding_state,
    binding_calls: value.binding_calls,
    invalid_payloads: value.invalid_payloads,
    documents_delivered: value.documents_delivered,
    fallback_pages_evaluated: value.fallback_pages_evaluated,
    provenance: 'owned_playwright_page_binding_and_final_page_fallback',
  };
}

function validDelivery(value) {
  if (value === undefined || value === null) return true;
  return (
    plainObject(value) &&
    ['installed', 'unavailable'].includes(value.binding_state) &&
    boundedInteger(value.binding_calls, 0, 256) &&
    boundedInteger(value.invalid_payloads, 0, 256) &&
    boundedInteger(value.documents_delivered, 0, PLAYWRIGHT_REACT_LIMITS.documents) &&
    boundedInteger(value.fallback_pages_evaluated, 0, PLAYWRIGHT_REACT_LIMITS.documents) &&
    value.provenance === 'owned_playwright_page_binding_and_final_page_fallback'
  );
}

function lifecycleReason(value) {
  if (!value) return 'The React diagnostic pass emitted no valid lifecycle or document evidence.';
  if (value.binding_state === 'unavailable') {
    return 'The React diagnostic binding was unavailable and final-page fallback emitted no usable document evidence.';
  }
  return 'The React diagnostic fixture completed, but no bounded React document report was delivered.';
}

function canonicalDocumentToken(value) {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

function normalizeComponent(value, { requireSelfDuration = false } = {}) {
  if (
    !plainObject(value) ||
    typeof value.name !== 'string' ||
    value.name.length < 1 ||
    value.name.length > PLAYWRIGHT_REACT_LIMITS.componentNameCharacters ||
    !boundedInteger(value.active_fiber_count, 1, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(value.commits_present, 1, Number.MAX_SAFE_INTEGER) ||
    !boundedDuration(value.inclusive_actual_duration_ms) ||
    !boundedDuration(value.max_actual_duration_ms) ||
    (requireSelfDuration &&
      (!boundedDuration(value.self_actual_duration_ms) ||
        !boundedDuration(value.max_self_actual_duration_ms))) ||
    (value.ownership !== undefined &&
      !['repository', 'external_or_ambiguous'].includes(value.ownership)) ||
    (value.source !== undefined && !validComponentSource(value.source, value.ownership))
  ) {
    throw new Error('Playwright React component evidence is invalid');
  }
  return {
    ...roundComponent(value, { includeSelfDuration: requireSelfDuration }),
    ...(value.ownership === undefined
      ? {}
      : { ownership: value.ownership, source: value.source ?? null }),
  };
}

function roundComponent(value, { includeSelfDuration = false } = {}) {
  return {
    name: value.name,
    active_fiber_count: value.active_fiber_count,
    commits_present: value.commits_present,
    inclusive_actual_duration_ms: round3(value.inclusive_actual_duration_ms),
    max_actual_duration_ms: round3(value.max_actual_duration_ms),
    ...(includeSelfDuration
      ? {
          self_actual_duration_ms: round3(value.self_actual_duration_ms),
          max_self_actual_duration_ms: round3(value.max_self_actual_duration_ms),
        }
      : {}),
  };
}

function validSourceAttribution(value) {
  return (
    value === null ||
    (plainObject(value) &&
      Object.keys(value).every((key) =>
        [
          'state',
          'files_scanned',
          'bytes_scanned',
          'file_limit',
          'byte_limit',
          'provenance',
        ].includes(key)
      ) &&
      ['complete', 'partial'].includes(value.state) &&
      boundedInteger(value.files_scanned, 0, 512) &&
      boundedInteger(value.bytes_scanned, 0, 4 * 1024 * 1024) &&
      value.file_limit === 512 &&
      value.byte_limit === 4 * 1024 * 1024 &&
      value.provenance === 'bounded_static_component_declaration_scan')
  );
}

function validAuthority(value) {
  return (
    value === null ||
    (plainObject(value) &&
      typeof value.package_path === 'string' &&
      value.package_path.length > 0 &&
      !value.package_path.startsWith('/') &&
      !value.package_path.split('/').includes('..') &&
      Array.isArray(value.declared_packages) &&
      value.declared_packages.length > 0 &&
      value.declared_packages.every((entry) => ['react', 'react-dom'].includes(entry)) &&
      value.provenance === 'nearest_package_manifest_declared_dependency')
  );
}

function validComponentSource(value, ownership) {
  if (ownership === 'external_or_ambiguous') return value === null;
  return (
    ownership === 'repository' &&
    plainObject(value) &&
    typeof value.file === 'string' &&
    value.file.length > 0 &&
    !value.file.startsWith('/') &&
    !value.file.split('/').includes('..') &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    value.provenance === 'static_unique_react_component_declaration'
  );
}

function componentDeclaration(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|class)\\s+${escaped}\\b|(?:^|\\n)\\s*(?:export\\s+)?(?:const|let)\\s+${escaped}\\s*=`,
    'g'
  );
  const match = pattern.exec(source);
  if (!match) return null;
  return source.slice(0, match.index).split('\n').length;
}

const SOURCE_EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  'test-results',
  'playwright-report',
]);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function boundedDuration(value) {
  return Number.isFinite(value) && value >= 0 && value <= 60 * 60 * 1_000;
}

function round3(value) {
  return Math.round(value * 1_000) / 1_000;
}

export function reactCommitHookInit() {
  const telemetryKey = '__CODEVETTER_REACT_COMMITS__';
  const bindingName = '__codevetterReportReact_8f3c2a1d';
  const documentToken = Array.from({ length: 2 }, () =>
    Math.floor(Math.random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, '0')
  ).join('');
  function deliver(value) {
    const binding = globalThis[bindingName];
    if (typeof binding !== 'function') return;
    Promise.resolve(binding(value)).catch(() => {});
  }
  const existing = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (existing) {
    globalThis[telemetryKey] = {
      schema_version: 'runtime-playwright-react-document/v2',
      hook_state: 'existing_hook',
      document_token: documentToken,
      renderer_versions: [],
      commit_count: 0,
      profiled_commit_count: 0,
      total_actual_duration_ms: 0,
      max_commit_duration_ms: 0,
      measurement_complete: true,
      presentation_truncated: false,
      self_duration_provenance: 'inclusive_minus_direct_child_actual_duration',
      components: [],
      truncated: false,
    };
    deliver(globalThis[telemetryKey]);
    return;
  }
  const limits = { commits: 128, components: 64, fibers: 10_000, name: 120 };
  const telemetry = {
    schema_version: 'runtime-playwright-react-document/v2',
    hook_state: 'installed',
    document_token: documentToken,
    renderer_versions: [],
    commit_count: 0,
    profiled_commit_count: 0,
    total_actual_duration_ms: 0,
    max_commit_duration_ms: 0,
    measurement_complete: true,
    presentation_truncated: false,
    self_duration_provenance: 'inclusive_minus_direct_child_actual_duration',
    components: [],
    truncated: false,
  };
  const renderers = new Map();
  const components = new Map();
  let rendererSequence = 0;
  function boundedDuration(value) {
    return Number.isFinite(value) && value > 0 && value <= 60 * 60 * 1_000 ? value : 0;
  }
  function componentName(fiber) {
    const type = fiber?.type;
    if (typeof type === 'string') return null;
    const elementType = fiber?.elementType;
    const name =
      (typeof type === 'function' && (type.displayName || type.name)) ||
      (type && typeof type === 'object' && (type.displayName || type.name)) ||
      (typeof elementType === 'function' && (elementType.displayName || elementType.name)) ||
      (elementType &&
        typeof elementType === 'object' &&
        (elementType.displayName || elementType.name));
    return typeof name === 'string' && name.length > 0 && name.length <= limits.name ? name : null;
  }
  function onCommitFiberRoot(_rendererId, root) {
    if (telemetry.commit_count >= limits.commits) {
      telemetry.truncated = true;
      telemetry.measurement_complete = false;
      return;
    }
    telemetry.commit_count += 1;
    const rootDuration = boundedDuration(root?.current?.actualDuration);
    if (rootDuration > 0) {
      telemetry.profiled_commit_count += 1;
      telemetry.total_actual_duration_ms += rootDuration;
      telemetry.max_commit_duration_ms = Math.max(telemetry.max_commit_duration_ms, rootDuration);
    }
    const seen = new Set();
    const stack = root?.current ? [root.current] : [];
    let traversed = 0;
    while (stack.length > 0 && traversed < limits.fibers) {
      const fiber = stack.pop();
      traversed += 1;
      if (fiber?.sibling) stack.push(fiber.sibling);
      if (fiber?.child) stack.push(fiber.child);
      const duration = boundedDuration(fiber?.actualDuration);
      if (duration === 0) continue;
      let directChildDuration = 0;
      let child = fiber?.child;
      let directChildren = 0;
      while (child && directChildren < limits.fibers) {
        directChildDuration += boundedDuration(child.actualDuration);
        child = child.sibling;
        directChildren += 1;
      }
      if (child) {
        telemetry.measurement_complete = false;
        telemetry.truncated = true;
      }
      const selfDuration = Math.max(0, duration - directChildDuration);
      const name = componentName(fiber);
      if (!name) continue;
      let current = components.get(name);
      if (!current) {
        if (components.size >= limits.components) {
          telemetry.truncated = true;
          telemetry.presentation_truncated = true;
          continue;
        }
        current = {
          name,
          active_fiber_count: 0,
          commits_present: 0,
          inclusive_actual_duration_ms: 0,
          max_actual_duration_ms: 0,
          self_actual_duration_ms: 0,
          max_self_actual_duration_ms: 0,
        };
        components.set(name, current);
      }
      current.active_fiber_count += 1;
      current.inclusive_actual_duration_ms += duration;
      current.max_actual_duration_ms = Math.max(current.max_actual_duration_ms, duration);
      current.self_actual_duration_ms += selfDuration;
      current.max_self_actual_duration_ms = Math.max(
        current.max_self_actual_duration_ms,
        selfDuration
      );
      if (!seen.has(name)) {
        seen.add(name);
        current.commits_present += 1;
      }
    }
    if (stack.length > 0) {
      telemetry.truncated = true;
      telemetry.measurement_complete = false;
    }
    telemetry.components = [...components.values()];
    deliver(telemetry);
  }
  const hook = {
    supportsFiber: true,
    isDisabled: false,
    renderers,
    inject(renderer) {
      rendererSequence += 1;
      renderers.set(rendererSequence, renderer);
      const version = renderer?.version;
      if (
        typeof version === 'string' &&
        version.length <= 80 &&
        !telemetry.renderer_versions.includes(version) &&
        telemetry.renderer_versions.length < 8
      ) {
        telemetry.renderer_versions.push(version);
      }
      deliver(telemetry);
      return rendererSequence;
    },
    onCommitFiberRoot,
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  Object.defineProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    value: hook,
    configurable: true,
  });
  globalThis[telemetryKey] = telemetry;
  deliver(telemetry);
  globalThis.addEventListener?.('pagehide', () => deliver(telemetry), { once: true });
}

export const REACT_COMMIT_HOOK_SOURCE = `(${reactCommitHookInit.toString()})();`;
