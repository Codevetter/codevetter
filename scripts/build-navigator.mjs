import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const typescriptRoot = dirname(require.resolve('navigator-typescript/package.json'));
const platformRoot = dirname(
  require.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`, {
    paths: [typescriptRoot],
  })
);
const semanticRoot = join(root, 'artifacts/navigator-typescript');
mkdirSync(semanticRoot, { recursive: true });
cpSync(join(platformRoot, 'lib'), join(semanticRoot, 'lib'), { recursive: true });
for (const name of ['LICENSE', 'NOTICE.txt'])
  copyFileSync(join(platformRoot, name), join(semanticRoot, name));
const release = process.argv.includes('--release') || process.env.CONFIGURATION === 'Release';
const manifest = join(root, 'crates/codevetter-navigator/Cargo.toml');
const args = ['build', '--locked', '--manifest-path', manifest];
if (release) args.push('--release');
execFileSync('cargo', args, { stdio: 'inherit' });
if (process.argv.includes('--embed')) {
  const target = process.env.TARGET_BUILD_DIR;
  const frameworks = process.env.FRAMEWORKS_FOLDER_PATH;
  if (!target || !frameworks) throw new Error('Embedding requires Xcode target build paths');
  const destination = join(target, frameworks, 'libcodevetter_navigator.dylib');
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(
    join(
      root,
      'crates/codevetter-navigator/target',
      release ? 'release' : 'debug',
      'libcodevetter_navigator.dylib'
    ),
    destination
  );
  const resources = process.env.UNLOCALIZED_RESOURCES_FOLDER_PATH;
  if (!resources) throw new Error('Embedding requires Xcode resource paths');
  const semanticDestination = join(target, resources, 'TypeScript');
  cpSync(semanticRoot, semanticDestination, { recursive: true });
  // Normal local-build signing; publishing still belongs to the existing release pipeline.
  if (process.env.CODE_SIGNING_ALLOWED !== 'NO') {
    execFileSync(
      '/usr/bin/codesign',
      ['--force', '--sign', process.env.EXPANDED_CODE_SIGN_IDENTITY || '-', destination],
      { stdio: 'inherit' }
    );
    execFileSync(
      '/usr/bin/codesign',
      [
        '--force',
        '--sign',
        process.env.EXPANDED_CODE_SIGN_IDENTITY || '-',
        join(semanticDestination, 'lib/tsc'),
      ],
      { stdio: 'inherit' }
    );
  }
}
