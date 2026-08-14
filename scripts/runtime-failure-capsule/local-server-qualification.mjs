import { createHash } from 'node:crypto';

const FAMILY_DEFAULT_PORT = Object.freeze({
  wrangler: 8787,
  vite: 5173,
  next: 3000,
});
const MAX_SCRIPT_DEPTH = 4;
const MAX_SCRIPTS = 16;

export function inferDeclaredBrowserServer({ configSource, baseUrl, manifest }) {
  const command =
    staticWebServerCommand(configSource) ?? staticFrontendScript(manifest?.scripts ?? {});
  if (!command) return null;
  let port;
  try {
    const url = new URL(baseUrl);
    port = url.port ? Number(url.port) : 80;
  } catch {
    return null;
  }
  const commands = expandPackageCommands(command, manifest?.scripts ?? {});
  const candidates = commands.flatMap(classifyServerCommands);
  const exactPort = candidates.filter((candidate) => candidate.port === port);
  const considered =
    exactPort.length > 0 ? exactPort : candidates.filter((candidate) => candidate.port === null);
  const families = [...new Set(considered.map((candidate) => candidate.family))];
  if (families.length !== 1) return null;
  return {
    family: families[0],
    command_sha256: createHash('sha256').update(command).digest('hex'),
  };
}

function staticFrontendScript(scripts) {
  for (const name of ['dev:test-auth', 'dev:fe', 'dev', 'start']) {
    const command = scripts[name];
    if (typeof command !== 'string' || command.length > 4_000) continue;
    const candidates = classifyServerCommands(command);
    if (candidates.length === 1 && ['vite', 'next'].includes(candidates[0].family)) return command;
  }
  return null;
}

export function staticWebServerCommand(source) {
  const block = staticObjectProperty(source, 'webServer');
  if (!block) return null;
  const values = staticStringProperties(block, 'command');
  return values.length === 1 ? values[0] : null;
}

function expandPackageCommands(rootCommand, scripts) {
  const queue = [{ command: rootCommand, depth: 0 }];
  const commands = [];
  const visited = new Set();
  while (queue.length > 0 && commands.length < MAX_SCRIPTS) {
    const current = queue.shift();
    commands.push(current.command);
    if (current.depth >= MAX_SCRIPT_DEPTH) continue;
    for (const name of packageScriptReferences(current.command)) {
      const script = scripts[name];
      if (typeof script !== 'string' || script.length === 0 || script.length > 4_000) continue;
      const key = `${name}\0${script}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ command: script, depth: current.depth + 1 });
    }
  }
  return commands;
}

function packageScriptReferences(command) {
  const names = [];
  for (const match of command.matchAll(/\bpnpm\s+(?:run\s+)?([a-zA-Z0-9:_-]+)/g)) {
    if (!['exec', 'dlx', 'install', 'add'].includes(match[1])) names.push(match[1]);
  }
  for (const match of command.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)) names.push(match[1]);
  for (const match of command.matchAll(/\byarn\s+([a-zA-Z0-9:_-]+)/g)) {
    if (!['exec', 'dlx', 'install', 'add'].includes(match[1])) names.push(match[1]);
  }
  return [...new Set(names)].slice(0, MAX_SCRIPTS);
}

function classifyServerCommands(command) {
  const candidates = [];
  for (const segment of command.split(/&&|\|\||;|\n/).slice(0, 32)) {
    const normalized = segment.trim();
    if (/\bwrangler\s+dev\b/.test(normalized)) {
      candidates.push({ family: 'wrangler', port: commandPort(normalized, 8787) });
    }
    if (/\bnext\s+dev\b/.test(normalized)) {
      candidates.push({ family: 'next', port: commandPort(normalized, 3000) });
    }
    if (
      /\bvite(?:\s+dev)?(?:\s|$)/.test(normalized) &&
      !/\bvite\s+(?:build|preview)\b/.test(normalized)
    ) {
      candidates.push({ family: 'vite', port: commandPort(normalized, 5173) });
    }
    if (/\bnode\s+[^\s;&|]+/.test(normalized)) {
      candidates.push({ family: 'node', port: explicitCommandPort(normalized) });
    }
  }
  return candidates;
}

function commandPort(command, defaultPort) {
  return explicitCommandPort(command) ?? FAMILY_DEFAULT_PORT[serverFamily(command)] ?? defaultPort;
}

function explicitCommandPort(command) {
  const match = command.match(/(?:^|\s)--port(?:=|\s+)(\d{1,5})(?=\s|$)/);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65_535 ? port : null;
}

function serverFamily(command) {
  if (/\bwrangler\s+dev\b/.test(command)) return 'wrangler';
  if (/\bnext\s+dev\b/.test(command)) return 'next';
  if (/\bvite\b/.test(command)) return 'vite';
  return 'node';
}

function staticObjectProperty(source, property) {
  let index = 0;
  while (index < source.length) {
    const next = nextCodeToken(source, index);
    if (!next) return null;
    index = next.index;
    if (
      source.startsWith(property, index) &&
      !identifier(source[index - 1]) &&
      !identifier(source[index + property.length])
    ) {
      let cursor = skipTrivia(source, index + property.length);
      if (source[cursor] !== ':') {
        index += property.length;
        continue;
      }
      cursor = skipTrivia(source, cursor + 1);
      if (source[cursor] !== '{') return null;
      const end = matchingBrace(source, cursor);
      return end === null ? null : source.slice(cursor + 1, end);
    }
    index += 1;
  }
  return null;
}

function staticStringProperties(source, property) {
  const values = [];
  let index = 0;
  while (index < source.length) {
    const next = nextCodeToken(source, index);
    if (!next) break;
    index = next.index;
    if (
      source.startsWith(property, index) &&
      !identifier(source[index - 1]) &&
      !identifier(source[index + property.length])
    ) {
      let cursor = skipTrivia(source, index + property.length);
      if (source[cursor] !== ':') {
        index += property.length;
        continue;
      }
      cursor = skipTrivia(source, cursor + 1);
      const quote = source[cursor];
      if (quote !== "'" && quote !== '"') return [];
      const parsed = readQuoted(source, cursor, quote);
      if (!parsed) return [];
      values.push(parsed.value);
      index = parsed.end;
      continue;
    }
    index += 1;
  }
  return values;
}

function matchingBrace(source, start) {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character === "'" || character === '"' || character === '`') {
      index = skipQuote(source, index, character);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = skipLine(source, index + 2);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipBlock(source, index + 2);
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return null;
}

function nextCodeToken(source, start) {
  let index = start;
  while (index < source.length) {
    if (source[index] === "'" || source[index] === '"' || source[index] === '`') {
      index = skipQuote(source, index, source[index]);
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLine(source, index + 2);
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlock(source, index + 2);
      continue;
    }
    return { index };
  }
  return null;
}

function skipTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLine(source, index + 2);
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlock(source, index + 2);
      continue;
    }
    break;
  }
  return index;
}

function readQuoted(source, start, quote) {
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' || character === '\n' || character === '\r') return null;
    if (character === quote) return { value, end: index + 1 };
    value += character;
  }
  return null;
}

function skipQuote(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return source.length;
}

function skipLine(source, start) {
  const end = source.indexOf('\n', start);
  return end === -1 ? source.length : end + 1;
}

function skipBlock(source, start) {
  const end = source.indexOf('*/', start);
  return end === -1 ? source.length : end + 2;
}

function identifier(value) {
  return typeof value === 'string' && /[A-Za-z0-9_$]/.test(value);
}
