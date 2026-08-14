import { pathToFileURL } from 'node:url';

const [viteModule, root, host, rawPort, marker] = process.argv.slice(2);
const port = Number(rawPort);
if (
  marker !== '--codevetter-server-family=vite' ||
  !viteModule ||
  !root ||
  !['127.0.0.1', '::1'].includes(host) ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65_535
) {
  process.exitCode = 2;
} else {
  const { createServer } = await import(pathToFileURL(viteModule).href);
  const server = await createServer({
    root,
    configFile: false,
    envDir: false,
    mode: 'codevetter',
    clearScreen: false,
    logLevel: 'silent',
    resolve: { alias: { '@': root } },
    server: { host, port, strictPort: true },
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
  await server.listen();
}
