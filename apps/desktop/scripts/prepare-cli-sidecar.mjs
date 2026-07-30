import { prepareRustSidecar } from './prepare-rust-sidecar.mjs';

prepareRustSidecar({
  binary: 'codevetter',
  release: process.argv.includes('--release'),
  features: ['browser-agent'],
});
