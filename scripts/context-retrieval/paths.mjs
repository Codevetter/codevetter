// One shared definition of "what counts as a file path", imported by every adapter.
//
// It exists because there were four. generic-cli, mcp-client, controls and
// agent-default each carried their own extension allowlist, and no two agreed:
//
//   generic-cli    ts tsx js jsx mjs cjs py go rs java rb php swift kt astro
//   mcp-client     ts tsx js jsx mjs cjs rs py go java astro sql json
//   controls       ts tsx mjs js rs astro py go swift sql json toml yaml yml
//   agent-default  ts tsx mjs js rs astro py go swift sql json
//
// Two separate defects followed. The first is a ceiling: ground truth is "the files
// the fix touched", which across the corpus includes package.json, go.mod, go.sum,
// CHANGES.rst, globals.css, deploy-health.sh, .gitignore, pnpm-workspace.yaml,
// people.csv, index.html, Dockerfile, LICENSE, public/_headers and .husky/pre-push.
// 174 of 764 cases (22.8%) had at least one ground-truth file the generic-cli
// vocabulary could not express, so those cases were unscoreable however good the
// answer — and the rate ranged from 1.2% of fastify cases to 53.7% of
// today-little-log's, which biases repository-to-repository comparison too.
//
// The second is worse, because it is differential rather than uniform: an arm on
// mcp-client could name a .json file and an arm on generic-cli could not, so the arms
// were not being asked the same question. Comparison-based gates cannot catch that —
// checkControlsLose compares a tool against a control that had its own third
// vocabulary — which is the same blind spot that hid the ranking inversion.
//
// The rule here is deliberately not a list of file types. A candidate is path-SHAPED
// if it carries a separator or an extension; whether it is a real file is then settled
// by the filesystem at the case's base revision, which is the actual definition and
// needs no vocabulary.

// Conventional extensionless filenames. This is the one residual allowlist, and unlike
// a list of extensions it is genuinely closed: extensionless files appear at a
// repository root by convention and the conventions are few. Shape cannot carry these,
// because a tool writing "results complete" must not be credited with two files.
export const KNOWN_ROOT_FILES = new Set([
  'Dockerfile',
  'Makefile',
  'LICENSE',
  'LICENCE',
  'README',
  'CHANGELOG',
  'NOTICE',
  'CODEOWNERS',
  'Procfile',
  'Gemfile',
  'Rakefile',
  'Justfile',
  'Vagrantfile',
  'Brewfile',
]);

// Candidate path tokens in free text. The leading `(?:\.{0,2}\/)?` admits "./x", "../x"
// and absolute "/x": the earlier generic-cli pattern opened its capture with [\w.-],
// which cannot match "/", so a tool printing absolute paths matched nothing at all. ck
// delivered four correct .go files that way and was recorded at 0% recall.
export const PATH_TOKEN = /(?:^|[\s"'`(\[<{:,=])((?:\.{0,2}\/)?[\w.\-+@]+(?:\/[\w.\-+@]+)*)/g;

// Trailing sentence punctuation clings to paths in prose ("see src/app.ts.").
export const TRAILING_PUNCT = /[.,;:!?)\]}>'"`]+$/;

export function pathShaped(token) {
  if (!token || token.length > 300 || token.startsWith('-')) return false;
  if (token.includes('/')) return true;
  if (/\.[A-Za-z0-9]{1,10}$/.test(token)) return true;
  return KNOWN_ROOT_FILES.has(token);
}

// Raw candidates from text, punctuation trimmed, order and duplicates preserved so
// callers can rank by first mention.
export function pathTokensIn(text) {
  const found = [];
  for (const match of String(text).matchAll(PATH_TOKEN)) {
    const token = match[1].replace(TRAILING_PUNCT, '');
    if (pathShaped(token)) found.push(token);
  }
  return found;
}

// The universe a control may draw from, and the universe ground truth is drawn from:
// every file tracked at the revision. Restricting it to source code — as three of the
// four allowlists did — makes the control answer an easier question than the tools,
// which is exactly the asymmetry the controls exist to rule out. Widening it does make
// the random control weaker, and that direction flatters every real provider, so it is
// recorded here rather than left as a silent default: the pool has to match the ground
// truth, and corpus ground truth contains .rst, .css, .sh, .mod and even .webp files.
export function isCandidateFile(path) {
  return Boolean(path) && !path.endsWith('/');
}
