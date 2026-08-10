import { LIMITS } from './contracts.mjs';

const CREDENTIAL_KEY =
  /((?:api[_-]?key|token|secret|password|passwd|client[_-]?secret|private[_-]?key)\s*[=:]\s*)([^\s,;"']+)/gi;
const AUTHORIZATION =
  /((?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s,;]+/gi;
const COOKIE = /((?:set-cookie|cookie)\s*[:=]\s*)[^\r\n]+/gi;
const URL_QUERY = /(https?:\/\/[^\s?#]+)\?[^\s#"']+/gi;

export function redactText(
  input,
  {
    repositoryRoot,
    repositoryRoots = [],
    sensitiveFields = [],
    environmentValues = [],
    limit = LIMITS.summaryCharacters,
  } = {}
) {
  let text = String(input ?? '');
  let redactionCount = 0;

  const replace = (pattern, replacement) => {
    text = text.replace(pattern, (...args) => {
      redactionCount += 1;
      return replacement(...args);
    });
  };

  const roots = [...new Set([repositoryRoot, ...repositoryRoots].filter(Boolean))]
    .map((root) => String(root).replace(/[\\/]+$/, ''))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const root of roots) {
    replaceAllLiteral(root, '<repo>');
  }
  for (const value of environmentValues) {
    if (typeof value === 'string' && value.length >= 8) replaceAllLiteral(value, '<redacted:env>');
  }
  for (const field of sensitiveFields) {
    if (typeof field !== 'string' || field.length === 0) continue;
    const escaped = escapeRegExp(field);
    replace(
      new RegExp(`(${escaped}\\s*[=:]\\s*)([^\\s,;]+)`, 'gi'),
      (_match, prefix) => `${prefix}<redacted>`
    );
  }

  replace(CREDENTIAL_KEY, (_match, prefix) => `${prefix}<redacted>`);
  replace(AUTHORIZATION, (_match, prefix) => `${prefix}<redacted>`);
  replace(COOKIE, (_match, prefix) => `${prefix}<redacted>`);
  replace(URL_QUERY, (_match, base) => `${base}?<redacted:query>`);

  const truncated = text.length > limit;
  if (truncated) text = text.slice(0, limit);
  return { text, redaction_count: redactionCount, truncated };

  function replaceAllLiteral(value, replacement) {
    let offset = text.indexOf(value);
    while (offset !== -1) {
      redactionCount += 1;
      text = `${text.slice(0, offset)}${replacement}${text.slice(offset + value.length)}`;
      offset = text.indexOf(value, offset + replacement.length);
    }
  }
}

export function redactJsonValue(value, options = {}) {
  const state = { redaction_count: 0, truncated: false };
  const sanitized = visit(value, 0);
  return { value: sanitized, ...state };

  function visit(candidate, depth) {
    if (depth > 16) {
      state.truncated = true;
      return '<truncated:depth>';
    }
    if (typeof candidate === 'string') {
      const result = redactText(candidate, options);
      state.redaction_count += result.redaction_count;
      state.truncated ||= result.truncated;
      return result.text;
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > 100) state.truncated = true;
      return candidate.slice(0, 100).map((entry) => visit(entry, depth + 1));
    }
    if (candidate && typeof candidate === 'object') {
      const entries = Object.entries(candidate);
      if (entries.length > 100) state.truncated = true;
      return Object.fromEntries(
        entries.slice(0, 100).map(([key, entry]) => {
          if (isSensitiveKey(key)) {
            state.redaction_count += 1;
            return [key, '<redacted>'];
          }
          return [key, visit(entry, depth + 1)];
        })
      );
    }
    return candidate;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSensitiveKey(key) {
  return /^(?:authorization|cookie|set-cookie|api[_-]?key|token|secret|password|passwd|client[_-]?secret|private[_-]?key)$/i.test(
    key
  );
}
