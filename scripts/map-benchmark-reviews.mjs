#!/usr/bin/env node
// Convert raw CodeVetter pipeline output (benchmark/reviews-raw/<id>.codevetter.raw.json,
// produced by the diag_benchmark_generate_codevetter_reviews harness) into the
// scorer's reviewer format at benchmark/reviews/<id>.codevetter.json.
//
// Ground-truth matching here is a mechanical PROPOSAL (line overlap + keyword
// correspondence); every proposed file is meant to be hand-checked before
// scoring — the scorer treats unmatched findings as false positives, so
// generous auto-matching would inflate precision dishonestly.
//
// Usage:
//   node scripts/map-benchmark-reviews.mjs           # write drafts + report
//   node scripts/map-benchmark-reviews.mjs --dry     # report only
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'benchmark');
const CASES = path.join(ROOT, 'cases');
const RAW = path.join(ROOT, 'reviews-raw');
const OUT = path.join(ROOT, 'reviews');
const dry = process.argv.includes('--dry');

// Keyword families per ground-truth `type`. A finding matches a family when
// its title+summary mention any keyword. Deliberately narrow — near-misses
// should surface in the report for human judgment, not silently match.
const TYPE_KEYWORDS = {
  sql_injection: [
    'sql injection',
    'sql-injection',
    'parameteriz',
    'string concatenation into',
    'interpolat',
  ],
  xss: ['xss', 'cross-site scripting', 'innerhtml', 'unescaped', 'sanitiz'],
  hardcoded_credentials: ['hardcoded', 'hard-coded', 'credential', 'secret', 'api key', 'password'],
  hardcoded_secret: ['hardcoded', 'hard-coded', 'secret', 'api key', 'credential', 'password'],
  command_injection: ['command injection', 'shell', 'exec', 'subprocess', 'os.system'],
  path_traversal: ['path traversal', 'directory traversal', '../', 'join(', 'normaliz'],
  ssrf: ['ssrf', 'server-side request forgery', 'url fetch', 'internal network', 'metadata'],
  insecure_deserialization: ['deserializ', 'pickle', 'unpickl', 'yaml.load', 'marshal'],
  weak_hash: ['md5', 'sha1', 'sha-1', 'weak hash', 'weak hashing', 'outdated hash'],
  insecure_random: ['random', 'prng', 'securerandom', 'predictable'],
  race_condition: ['race', 'data race', 'concurrent', 'mutex', 'atomic', 'lock'],
  nil_pointer: ['nil pointer', 'nil deref', 'null pointer', 'nil check'],
  errcheck: ['unchecked error', 'error not checked', 'ignored error', 'error return', 'err !='],
  eval_injection: ['eval', 'code injection', 'function constructor'],
  open_redirect: ['open redirect', 'redirect', 'unvalidated url'],
  bare_except: ['bare except', 'except:', 'broad exception', 'swallow'],
  zip_bomb: ['zip bomb', 'decompression', 'extractall', 'uncompressed size'],
  integer_overflow: ['overflow', 'wrapping', 'checked_', 'saturating'],
  dead_code: ['dead code', 'unused', 'unreachable'],
  missing_await: ['await', 'unawaited', 'floating promise', 'promise not awaited'],
  prototype_pollution: ['prototype pollution', '__proto__', 'constructor.prototype'],
  regex_dos: ['redos', 'regex dos', 'catastrophic backtracking', 'exponential'],
  insecure_cookie: ['cookie', 'httponly', 'secure flag', 'samesite'],
  type_confusion: ['type confusion', 'any', 'unsafe cast', 'as unknown'],
};

function keywordsFor(type) {
  if (TYPE_KEYWORDS[type]) return TYPE_KEYWORDS[type];
  // Fallback: split the type into words ("sql_injection" -> "sql injection").
  return [type.replace(/_/g, ' ')];
}

function findingText(f) {
  return `${f.title ?? ''} ${f.summary ?? ''} ${f.suggestion ?? ''}`.toLowerCase();
}

function linesOverlap(findingLine, gtLines, slack = 5) {
  if (findingLine == null || !Array.isArray(gtLines) || gtLines.length < 2) return true; // no line info → don't block on lines
  return findingLine >= gtLines[0] - slack && findingLine <= gtLines[1] + slack;
}

const report = [];
for (const caseId of fs
  .readdirSync(CASES)
  .filter((n) => fs.statSync(path.join(CASES, n)).isDirectory())
  .sort()) {
  const rawPath = path.join(RAW, `${caseId}.codevetter.raw.json`);
  if (!fs.existsSync(rawPath)) {
    report.push(`MISSING raw output: ${caseId}`);
    continue;
  }
  const label = JSON.parse(fs.readFileSync(path.join(CASES, caseId, 'label.json'), 'utf8'));
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const findings = raw.findings ?? [];

  const mapped = findings.map((f, i) => {
    const text = findingText(f);
    const matches = [];
    for (const gt of label.ground_truth) {
      const kw = keywordsFor(gt.type);
      const hasKeyword = kw.some((k) => text.includes(k));
      const hasLine = linesOverlap(f.line ?? null, gt.location?.lines);
      if (hasKeyword && hasLine) matches.push(gt.id);
    }
    return {
      id: `f-${i + 1}`,
      severity: (f.severity ?? 'medium').toLowerCase(),
      file: f.filePath ?? f.file_path ?? label.source_file,
      lines: f.line != null ? [f.line, f.line] : null,
      title: f.title ?? '(untitled)',
      matched_ground_truth: matches,
      rationale: f.summary ?? '',
    };
  });

  const caught = new Set(mapped.flatMap((m) => m.matched_ground_truth));
  const gtIds = label.ground_truth.map((g) => g.id);
  report.push(
    `${caseId}: findings=${mapped.length} matched_gt=${caught.size}/${gtIds.length}` +
      ` unmatched_findings=${mapped.filter((m) => m.matched_ground_truth.length === 0).length}` +
      (gtIds.filter((id) => !caught.has(id)).length
        ? ` MISSED=[${gtIds.filter((id) => !caught.has(id)).join(',')}]`
        : '')
  );

  if (!dry) {
    const out = { case_id: caseId, reviewer: 'codevetter', findings: mapped };
    fs.writeFileSync(
      path.join(OUT, `${caseId}.codevetter.json`),
      `${JSON.stringify(out, null, 2)}\n`
    );
  }
}
console.log(report.join('\n'));
