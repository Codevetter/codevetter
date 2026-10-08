#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { skillNames } from './install-agent-skills.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templates = ['plugin.json', '.codex-plugin/plugin.json', '.mcp.json', 'mcp.json'];
const skillFiles = skillNames.flatMap((name) => [
  `skills/${name}/SKILL.md`,
  `skills/${name}/agents/openai.yaml`,
]);
export const runtimeFiles = [
  ...skillFiles,
  'skills/codevetter-evaluate/references/usage-loop.md',
  'skills/codevetter-evaluate/references/value-protocol.md',
  'skills/codevetter-evaluate/scripts/invoke.py',
  'skills/codevetter-evaluate/scripts/outcomes.py',
  'skills/codevetter-evaluate/scripts/telemetry.py',
  'scripts/agent-plugin/mcp.py',
];

function regularBytes(root, path) {
  let current = root;
  if (lstatSync(current).isSymbolicLink()) throw new Error('Source symlink refused');
  for (const component of path.split('/')) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Source symlink refused: ${path}`);
  }
  if (!lstatSync(current).isFile()) throw new Error(`Regular source file required: ${path}`);
  return readFileSync(current);
}

export function buildAgentPlugin({ output, sourceRoot = repositoryRoot } = {}) {
  if (!output) throw new Error('An explicit output marketplace directory is required');
  const destination = resolve(output);
  const source = resolve(sourceRoot);
  const files = new Map();
  for (const path of templates) files.set(path, regularBytes(source, `plugins/codevetter/${path}`));
  for (const path of runtimeFiles) files.set(path, regularBytes(source, path));
  const portable = JSON.parse(files.get('plugin.json'));
  const compatibility = JSON.parse(files.get('.codex-plugin/plugin.json'));
  if (
    portable.name !== 'codevetter' ||
    portable.name !== compatibility.name ||
    portable.version !== compatibility.version
  ) {
    throw new Error('Plugin identity/version mismatch');
  }
  for (const name of skillNames) {
    if (
      !files
        .get(`skills/${name}/agents/openai.yaml`)
        .toString()
        .includes('allow_implicit_invocation: true')
    ) {
      throw new Error(`Implicit invocation missing: ${name}`);
    }
  }
  // Validate everything before creating a new destination. Never overwrite a package.
  mkdirSync(destination, { recursive: false });
  const pluginRoot = join(destination, 'plugins/codevetter');
  const inventory = [];
  for (const [path, bytes] of files) {
    const target = join(pluginRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, {
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      mode: 0o644,
    });
    inventory.push({
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const marketplace = {
    name: 'codevetter-local',
    interface: { displayName: 'CodeVetter Local' },
    plugins: [
      {
        name: 'codevetter',
        source: { source: 'local', path: './plugins/codevetter' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      },
    ],
  };
  const marketPath = join(destination, '.agents/plugins/marketplace.json');
  mkdirSync(dirname(marketPath), { recursive: true });
  writeFileSync(marketPath, `${JSON.stringify(marketplace, null, 2)}\n`, { flag: 'wx' });
  const receipt = {
    schema_version: 'codevetter.plugin-package/v1',
    name: portable.name,
    version: portable.version,
    file_count: inventory.length,
    files: inventory,
    limitations: [
      'Package integrity is not host installation, automatic selection accuracy, or demonstrated agent value.',
    ],
  };
  writeFileSync(
    join(destination, 'package-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: 'wx' }
  );
  return { marketplace: destination, plugin: pluginRoot, receipt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output') {
      throw new Error(
        'Usage: node scripts/build-agent-plugin.mjs --output <new-marketplace-directory>'
      );
    }
    console.log(JSON.stringify(buildAgentPlugin({ output: args[1] }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
