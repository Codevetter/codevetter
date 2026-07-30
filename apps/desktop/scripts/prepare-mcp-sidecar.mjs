import { prepareRustSidecar } from './prepare-rust-sidecar.mjs';

prepareRustSidecar({
  binary: 'codevetter-mcp',
  release: process.argv.includes('--release'),
});
