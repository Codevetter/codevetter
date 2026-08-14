import { createRequire } from 'node:module';
import { createServer } from 'node:http';

import { installOwnedNextWriteGuard } from './owned-next-write-guard.mjs';

const [nextModule, root, host, rawPort, marker] = process.argv.slice(2);
const port = Number(rawPort);

if (
  marker !== '--codevetter-server-family=next' ||
  !nextModule ||
  !root ||
  !['127.0.0.1', '::1'].includes(host) ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65_535
) {
  process.exitCode = 2;
} else {
  installOwnedNextWriteGuard(root);
  const require = createRequire(import.meta.url);
  const loaded = require(nextModule);
  const next = loaded.default ?? loaded;
  const application = next({
    dev: true,
    dir: root,
    hostname: host,
    port,
    webpack: true,
    conf: {
      distDir: '.codevetter/next-runtime',
      images: { unoptimized: true },
    },
  });
  await application.prepare();
  const handle = application.getRequestHandler();
  const server = createServer((request, response) => handle(request, response));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await new Promise((resolvePromise) => server.close(resolvePromise));
    await application.close();
  };
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolvePromise);
  });
}
