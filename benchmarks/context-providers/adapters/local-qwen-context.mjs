import { execFile as execFileCallback } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const CONTEXT_FILE = '.codevetter-context.json';
const DIAGNOSTICS_FILE = '.codevetter-agent-diagnostics.json';
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;

const [workspaceArgument] = process.argv.slice(2);
const workspace = resolve(workspaceArgument ?? '.');
const endpoint = new URL('/v1/chat/completions', requiredEnvironment('CODEVETTER_LOCAL_MODEL_URL'));
const task = await readFile(join(workspace, 'TASK.md'), 'utf8');
const sources = await readSources(workspace);
const context = await readContext(workspace);
let inputTokens = 0;
let outputTokens = 0;
const toolCalls = [];

const diagnosisResponse = await complete(
  [
    {
      role: 'system',
      content:
        'Diagnose the concrete source-level defect for this small repository task. Identify the exact expression that violates the task and the smallest behavior-preserving correction. Be concise.',
    },
    {
      role: 'user',
      content: `Task:\n${task}\n\nRepository:\n${sources.map((file) => `--- ${file.path}\n${file.content}`).join('\n\n')}`,
    },
  ],
  300
);

let graphEvidence = null;
if (context !== null) {
  const queryResponse = await complete(
    [
      {
        role: 'system',
        content:
          'Choose one short structural-code search query. Return JSON only as {"query":"..."}.',
      },
      {
        role: 'user',
        content: `Task:\n${task}\n\nRepository files:\n${sources.map((file) => file.path).join('\n')}`,
      },
    ],
    80
  );
  const query = parseJsonObject(queryResponse.content).query;
  if (typeof query !== 'string' || query.trim().length === 0 || query.length > 200) {
    throw new Error('local model did not return a bounded graph query');
  }
  const { stdout } = await execFile(context.tool_path, [
    'query',
    context.snapshot_path,
    query.trim(),
    '20',
  ]);
  graphEvidence = JSON.parse(stdout);
  if (
    graphEvidence?.context?.snapshot_id !== context.snapshot_id ||
    graphEvidence?.context?.freshness?.indexed_head !== context.indexed_revision
  ) {
    throw new Error('structural context identity or revision drifted');
  }
  toolCalls.push('graph_query');
}

const sourceText = sources.map((file) => `--- ${file.path}\n${file.content}`).join('\n\n');
const evidenceText =
  graphEvidence === null
    ? 'No structural-context provider is available. Use only the repository files.'
    : `CodeVetter graph_query result:\n${JSON.stringify(graphEvidence)}`;
const repairResponse = await complete(
  [
    {
      role: 'system',
      content: [
        'You repair a small isolated repository task.',
        'Return JSON only as {"files":[{"path":"existing/relative/path","content_lines":["complete","file","lines"]}]}.',
        'Change the fewest existing files needed. Do not add files, tests, commentary, or markdown.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Task:\n${task}\n\nInitial diagnosis:\n${diagnosisResponse.content}\n\n${evidenceText}\n\nRepository:\n${sourceText}`,
    },
  ],
  1200
);
const repair = parseJsonObject(repairResponse.content);
if (!Array.isArray(repair.files) || repair.files.length === 0) {
  throw new Error('local model returned no repair files');
}

const existing = new Map(sources.map((file) => [file.path, file]));
const modified = [];
for (const candidate of repair.files) {
  if (
    !candidate ||
    typeof candidate.path !== 'string' ||
    !Array.isArray(candidate.content_lines) ||
    candidate.content_lines.some((line) => typeof line !== 'string')
  ) {
    throw new Error('local model returned an invalid repair file');
  }
  const file = existing.get(candidate.path);
  if (!file) throw new Error(`local model targeted a non-source path: ${candidate.path}`);
  const content = `${candidate.content_lines.join('\n')}\n`;
  if (content.trimEnd() !== file.content.trimEnd()) {
    await writeFile(join(workspace, candidate.path), content);
    modified.push(candidate.path);
  }
}
if (modified.length === 0) throw new Error('local model did not change the repository');

await writeFile(
  join(workspace, DIAGNOSTICS_FILE),
  `${JSON.stringify({
    schema_version: 'codevetter.agent-task-diagnostics.v1',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: 0,
    tool_calls: toolCalls.sort(),
    files_inspected: sources.map((file) => file.path).sort(),
    files_modified: [...new Set(modified)].sort(),
  })}\n`
);

async function complete(messages, maxTokens) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'mlx-community/Qwen3-4B-Instruct-2507-4bit',
      messages,
      temperature: 0,
      seed: 20260815,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`local model request failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) throw new Error('local model response exceeded limit');
  const document = JSON.parse(bytes.toString('utf8'));
  const content = document?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('local model response omitted content');
  }
  inputTokens += integerOrEstimate(document?.usage?.prompt_tokens, messages);
  outputTokens += integerOrEstimate(document?.usage?.completion_tokens, content);
  return { content };
}

async function readSources(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (
        entry.isFile() &&
        ![CONTEXT_FILE, DIAGNOSTICS_FILE, 'TASK.md'].includes(basename(path))
      ) {
        const content = await readFile(absolute, 'utf8');
        files.push({ path, content });
      }
    }
  }
  await visit(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const total = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
  if (total > MAX_SOURCE_BYTES) throw new Error('repository source exceeded adapter limit');
  return files;
}

async function readContext(root) {
  try {
    const value = JSON.parse(await readFile(join(root, CONTEXT_FILE), 'utf8'));
    const fields = ['indexed_revision', 'snapshot_id', 'snapshot_path', 'tool_path'];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== fields.join(',') ||
      fields.some((field) => typeof value[field] !== 'string' || value[field].length === 0)
    ) {
      throw new Error('invalid structural-context configuration');
    }
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function parseJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const value = JSON.parse(candidate);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('local model response was not a JSON object');
  }
  return value;
}

function integerOrEstimate(value, source) {
  if (Number.isInteger(value) && value >= 0) return value;
  const text = typeof source === 'string' ? source : JSON.stringify(source);
  return Math.ceil(Buffer.byteLength(text) / 4);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
