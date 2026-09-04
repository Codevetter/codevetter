#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const master = join(repositoryRoot, 'assets/brand/codevetter-mark.svg');
const iosMaster = join(repositoryRoot, 'assets/brand/codevetter-ios-app-icon.svg');
const nativeIcons = join(
  repositoryRoot,
  'apps/macos/CodeVetter/Assets.xcassets/AppIcon.appiconset'
);
const landingPublic = join(repositoryRoot, 'apps/landing-page-astro/public');

for (const mirror of [join(landingPublic, 'icon.svg'), join(landingPublic, 'favicon.svg')]) {
  copyFileSync(master, mirror);
}

for (const name of readdirSync(nativeIcons)) {
  if (!name.endsWith('.png')) continue;
  const target = join(nativeIcons, name);
  renderPng(master, target, pngWidth(target));
}

renderPng(iosMaster, join(landingPublic, 'apple-touch-icon.png'), 180);
renderPng(master, join(landingPublic, 'favicon-32.png'), 32);

run('sips', [
  '-s',
  'format',
  'ico',
  '--resampleHeightWidth',
  '64',
  '64',
  master,
  '--out',
  join(landingPublic, 'favicon.ico'),
]);

process.stdout.write('Generated CodeVetter brand assets from assets/brand/codevetter-mark.svg\n');

function renderPng(source, target, size) {
  run('sips', [
    '-s',
    'format',
    'png',
    '--resampleHeightWidth',
    String(size),
    String(size),
    source,
    '--out',
    target,
  ]);
}

function pngWidth(path) {
  const output = run('sips', ['-g', 'pixelWidth', path]);
  const match = output.match(/pixelWidth: (\d+)/);
  if (!match) throw new Error(`Could not read PNG width: ${path}`);
  return Number(match[1]);
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
