import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const nativeConfig = readFileSync(
  resolve(process.cwd(), '../macos/Config/Shared.xcconfig'),
  'utf8'
);
const version = nativeConfig.match(/^MARKETING_VERSION\s*=\s*(\S+)\s*$/m)?.[1];
if (!version) throw new Error('Native CodeVetter version is missing');

const currentReleaseVersion = `v${version}`;
export const currentReleaseUrl = `https://github.com/Codevetter/codevetter/releases/tag/${currentReleaseVersion}`;
