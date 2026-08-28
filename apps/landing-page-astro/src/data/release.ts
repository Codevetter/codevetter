import tauriConfig from '../../../desktop/src-tauri/tauri.conf.json';

const currentReleaseVersion = `v${tauriConfig.version}`;
export const currentReleaseUrl = `https://github.com/Codevetter/codevetter/releases/tag/${currentReleaseVersion}`;
