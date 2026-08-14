export const BROWSER_ARTIFACT_VERIFICATION_SCHEMA_VERSION =
  'browser-initial-route-artifact-verification/v1';

const MINIMUM_GZIP_BYTES = 8 * 1024;
const MINIMUM_PERCENT = 5;

export function verifyInitialRouteArtifactMovement({
  baseline,
  current,
  baselineSubject,
  currentSubject,
}) {
  const left = artifactSummary(baseline, 'baseline');
  const right = artifactSummary(current, 'current');
  const subjectsValid =
    baselineSubject?.source_snapshot_sha256 && currentSubject?.source_snapshot_sha256;
  if (!left || !right || !subjectsValid) {
    return report('no_confidence', 'Both artifacts require exact source-bound attestations.', null);
  }
  const delta = right.total_gzip_bytes - left.total_gzip_bytes;
  const percent = (delta / left.total_gzip_bytes) * 100;
  const observed = {
    baseline: left,
    current: right,
    gzip_delta_bytes: delta,
    gzip_delta_percent: round(percent),
    baseline_source_snapshot_sha256: baselineSubject.source_snapshot_sha256,
    current_source_snapshot_sha256: currentSubject.source_snapshot_sha256,
  };
  if (delta > 0 && (percent >= MINIMUM_PERCENT || delta >= MINIMUM_GZIP_BYTES)) {
    return report('rejected', 'Attested initial-route JavaScript materially regressed.', observed);
  }
  if (-delta >= MINIMUM_GZIP_BYTES && -percent >= MINIMUM_PERCENT) {
    return report('confirmed', 'Attested initial-route JavaScript materially decreased.', observed);
  }
  return report(
    'inconclusive',
    'Attested initial-route JavaScript did not clear both materiality floors.',
    observed
  );
}

function artifactSummary(value, label) {
  if (
    value?.state !== 'observed' ||
    value.verified !== true ||
    !Number.isInteger(value.total_bytes) ||
    value.total_bytes <= 0 ||
    !Number.isInteger(value.total_gzip_bytes) ||
    value.total_gzip_bytes <= 0 ||
    typeof value.artifact_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.artifact_sha256)
  ) {
    return null;
  }
  return {
    label,
    total_bytes: value.total_bytes,
    total_gzip_bytes: value.total_gzip_bytes,
    artifact_sha256: value.artifact_sha256,
  };
}

function report(status, reason, observed) {
  return {
    schema_version: BROWSER_ARTIFACT_VERIFICATION_SCHEMA_VERSION,
    verdict: { status, reason },
    observed,
    policy: {
      minimum_gzip_bytes: MINIMUM_GZIP_BYTES,
      minimum_percent: MINIMUM_PERCENT,
    },
    limitations: [
      'Artifact movement covers one statically closed initial route and does not establish field or production user impact.',
      'The verifier does not execute a build; both artifacts must come from a separately trusted source-bound builder.',
    ],
  };
}

function round(value) {
  return Number(value.toFixed(3));
}
