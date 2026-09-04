#!/usr/bin/env node
// Read-only verification for the public Sparkle appcast and its release archive.

const DEFAULT_ENDPOINT =
  'https://github.com/Codevetter/codevetter/releases/latest/download/appcast.xml';

function parseArgs(argv) {
  const options = { endpoint: DEFAULT_ENDPOINT, json: false };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--endpoint') options.endpoint = argv[++index];
    else if (argument.startsWith('--endpoint=')) options.endpoint = argument.slice(11);
  }
  return options;
}

async function reachable(url) {
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (head.status === 200) return { ok: true, status: head.status };
  const ranged = await fetch(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    redirect: 'follow',
  });
  return { ok: ranged.status === 200 || ranged.status === 206, status: ranged.status };
}

async function main() {
  const options = parseArgs(process.argv);
  const checks = [];
  const response = await fetch(options.endpoint, { redirect: 'follow' });
  checks.push({ name: 'appcast-download', ok: response.ok, detail: `HTTP ${response.status}` });
  if (!response.ok) return finish(options, checks);

  const xml = await response.text();
  const version = xml.match(/sparkle:shortVersionString="([^"]+)"/)?.[1];
  const asset = xml.match(/<enclosure\b[^>]*\burl="([^"]+)"/)?.[1];
  const signature = xml.match(/sparkle:edSignature="([^"]+)"/)?.[1];
  checks.push({
    name: 'version-semver',
    ok: /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? ''),
    detail: version ?? 'missing',
  });
  checks.push({
    name: 'sparkle-signature',
    ok: Boolean(signature),
    detail: signature ? `${signature.length} bytes` : 'missing',
  });
  checks.push({ name: 'archive-declared', ok: Boolean(asset), detail: asset ?? 'missing' });
  if (asset) {
    const result = await reachable(asset);
    checks.push({ name: 'archive-reachable', ok: result.ok, detail: `HTTP ${result.status}` });
  }
  return finish(options, checks);
}

function finish(options, checks) {
  const failed = checks.filter((check) => !check.ok);
  const receipt = {
    ok: failed.length === 0,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
  if (options.json) process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  else {
    for (const check of checks) {
      process.stdout.write(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}\n`);
    }
  }
  process.exitCode = receipt.ok ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`release verification failed: ${error.message}\n`);
  process.exitCode = 2;
});
