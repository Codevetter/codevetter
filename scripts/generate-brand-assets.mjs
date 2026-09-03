#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const master = join(repositoryRoot, 'assets/brand/codevetter-mark.svg');
const iosMaster = join(repositoryRoot, 'assets/brand/codevetter-ios-app-icon.svg');
const desktopIcons = join(repositoryRoot, 'apps/desktop/src-tauri/icons');
const nativeIcons = join(
  repositoryRoot,
  'apps/macos/CodeVetter/Assets.xcassets/AppIcon.appiconset'
);
const landingPublic = join(repositoryRoot, 'apps/landing-page-astro/public');

for (const mirror of [
  join(desktopIcons, 'icon.svg'),
  join(landingPublic, 'icon.svg'),
  join(landingPublic, 'favicon.svg'),
]) {
  copyFileSync(master, mirror);
}

for (const [name, size] of [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
]) {
  renderPng(master, join(desktopIcons, name), size);
}

for (const name of readdirSync(nativeIcons)) {
  if (!name.endsWith('.png')) continue;
  const target = join(nativeIcons, name);
  renderPng(master, target, pngWidth(target));
}

renderPng(iosMaster, join(landingPublic, 'apple-touch-icon.png'), 180);
renderPng(master, join(landingPublic, 'favicon-32.png'), 32);

const iconset = join(repositoryRoot, 'artifacts/brand/CodeVetter.iconset');
mkdirSync(iconset, { recursive: true });
for (const [name, size] of [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]) {
  renderPng(master, join(iconset, name), size);
}
run('iconutil', ['-c', 'icns', '-o', join(desktopIcons, 'icon.icns'), iconset]);
run('sips', [
  '-s',
  'format',
  'ico',
  '--resampleHeightWidth',
  '256',
  '256',
  master,
  '--out',
  join(desktopIcons, 'icon.ico'),
]);
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
