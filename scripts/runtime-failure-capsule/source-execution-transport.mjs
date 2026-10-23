// Optional source observations must not make an otherwise loadable capsule too large.
// The compact CLI JSON newline is part of the existing transport budget.
export function attachSourceExecution(capsule, snapshot, maximumBytes) {
  if (!snapshot) return;
  const candidate = {
    ...snapshot,
    snapshots: [...snapshot.snapshots],
    limitations: [...snapshot.limitations],
  };
  capsule.observed.source_execution = candidate;
  const fits = () => Buffer.byteLength(JSON.stringify(capsule)) + 1 <= maximumBytes;
  if (fits()) return;
  if (!candidate.limitations.includes('capture_bound_exceeded'))
    candidate.limitations.push('capture_bound_exceeded');
  while (candidate.snapshots.length && !fits()) candidate.snapshots.pop();
  if (fits()) return;
  delete capsule.observed.source_execution;
  // When even the empty observation cannot fit, preserve the existing core evidence.
  const marker = 'source_execution_capture_bound_exceeded';
  capsule.limitations.push(marker);
  if (!fits()) capsule.limitations.pop();
}
