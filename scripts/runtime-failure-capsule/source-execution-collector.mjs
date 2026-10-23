import { realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeTestSelectionExecuted } from './node-test-selection.mjs';
import { sourceDigest } from './source-execution.mjs';
import {
  capturedNames,
  currentNodeDigest,
  readBounded,
  readCapture,
} from './source-execution-artifacts.mjs';
import { mapCapturedSource } from './source-execution-map.mjs';
import {
  SOURCE_EXECUTION_SCHEMA,
  SOURCE_EXECUTION_SCOPE,
  SOURCE_EXECUTION_LIMITS,
  SOURCE_EXECUTION_REASONS,
  validateSourceExecutionSnapshot,
} from './source-execution-contract.mjs';

export async function collectSourceExecution(directory, repositoryRoot, execution, plan) {
  const output = {
    schema_version: SOURCE_EXECUTION_SCHEMA,
    scope: SOURCE_EXECUTION_SCOPE,
    recommendation_qualified: false,
    snapshots: [],
    limitations: [],
  };
  const limitations = new Set();
  const selected = execution?.nodeTestSelection;
  if (
    execution?.exitCode !== 0 ||
    !nodeTestSelectionExecuted(selected, selected?.name) ||
    !execution.coverageContext?.nonce ||
    !plan?.plan_id
  ) {
    return { ...output, limitations: ['execution_incomplete'] };
  }
  try {
    const root = await realpath(repositoryRoot);
    const expected = {
      nonce: execution.coverageContext.nonce,
      run_id: plan.plan_id,
      selection_sha256: sourceDigest(
        JSON.stringify({ target: selected.target, name: selected.name })
      ),
      runtime: process.version,
      node_binary_sha256: await currentNodeDigest(),
    };
    const listing = await capturedNames(directory);
    if (!listing.names.length) limitations.add('capture_unavailable');
    if (listing.truncated) limitations.add('capture_bound_exceeded');
    const work = { scripts: 0 };
    for (const name of listing.names) {
      try {
        const capture = await readCapture(directory, name, expected);
        await collectCapture(
          capture,
          root,
          expected,
          selected.matched.tests,
          output,
          limitations,
          work
        );
      } catch (error) {
        limitations.add(reason(error));
      }
    }
  } catch (error) {
    limitations.add(reason(error));
  }
  output.limitations = [...limitations];
  if (validateSourceExecutionSnapshot(output).length)
    return { ...output, snapshots: [], limitations: ['capture_bound_exceeded'] };
  return output;
}

async function collectCapture(capture, root, identity, selectedTests, output, limitations, work) {
  if (capture.document.result.length > 500 || capture.identity.truncated)
    limitations.add('capture_bound_exceeded');
  for (const script of capture.document.result.slice(0, 500)) {
    if (
      typeof script?.url !== 'string' ||
      !script.url.startsWith('file:') ||
      !script.url.endsWith('.ts')
    )
      continue;
    if (++work.scripts > SOURCE_EXECUTION_LIMITS.files) {
      limitations.add('capture_bound_exceeded');
      return;
    }
    try {
      const snapshot = await collectScript(
        capture,
        script,
        root,
        identity,
        selectedTests,
        limitations
      );
      if (!snapshot) continue;
      const candidate = {
        ...output,
        snapshots: [...output.snapshots, snapshot],
        limitations: [...SOURCE_EXECUTION_REASONS],
      };
      if (Buffer.byteLength(JSON.stringify(candidate)) > SOURCE_EXECUTION_LIMITS.bytes) {
        limitations.add('capture_bound_exceeded');
        return;
      }
      output.snapshots.push(snapshot);
    } catch (error) {
      limitations.add(reason(error));
    }
  }
}

async function collectScript(capture, script, root, identity, selectedTests, limitations) {
  const witnesses = capture.identity.sources.filter(
    (item) => item.script_id === script.scriptId && item.url === script.url
  );
  if (witnesses.length !== 1 || !/^[a-f0-9]{64}$/.test(witnesses[0].sha256)) {
    limitations.add('source_identity_mismatch');
    return null;
  }
  const source = await containedSource(root, script.url);
  const mapped = mapCapturedSource({
    source: source.text,
    url: script.url,
    generatedDigest: witnesses[0].sha256,
    functions: script.functions,
    identity,
    selectedTests,
  });
  if (mapped.reason) {
    limitations.add(mapped.reason);
    return null;
  }
  if (mapped.unknown) limitations.add('unqualified_anchor');
  if (mapped.truncated) limitations.add('capture_bound_exceeded');
  if (!mapped.anchors.length) return null;
  return {
    file: source.file,
    capture_id: capture.captureId,
    source_sha256: mapped.source_sha256,
    generated_sha256: mapped.generated_sha256,
    map_sha256: mapped.map_sha256,
    anchors: mapped.anchors,
  };
}

async function containedSource(root, url) {
  const path = fileURLToPath(url);
  const resolved = await realpath(path);
  const file = relative(root, resolved);
  if (
    path !== resolved ||
    isAbsolute(file) ||
    !file ||
    file.split('/').some((part) => part === '..' || part === 'node_modules')
  )
    throw new Error('source_unavailable');
  return {
    file,
    text: (await readBounded(resolved, SOURCE_EXECUTION_LIMITS.bytes)).toString('utf8'),
  };
}

function reason(error) {
  return SOURCE_EXECUTION_REASONS.includes(error?.message) ? error.message : 'capture_unavailable';
}
