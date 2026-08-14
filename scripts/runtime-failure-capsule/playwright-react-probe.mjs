import { writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
  PLAYWRIGHT_REACT_BINDING,
  REACT_COMMIT_HOOK_SOURCE,
  sanitizePlaywrightReactDocument,
} from './playwright-react.mjs';

export async function runPlaywrightReactProbe({ context, use, outputDirectory }) {
  const documents = new Map();
  const deliveredDocuments = new Set();
  const lifecycle = {
    schema_version: 'runtime-playwright-react-lifecycle/v1',
    fixture_started: true,
    binding_state: 'unavailable',
    binding_calls: 0,
    invalid_payloads: 0,
    documents_delivered: 0,
    fallback_pages_evaluated: 0,
    truncated: false,
    completed: false,
  };
  try {
    await context.exposeBinding(PLAYWRIGHT_REACT_BINDING, ({ page }, value) => {
      lifecycle.binding_calls = Math.min(256, lifecycle.binding_calls + 1);
      const key = retainDocument(documents, value, `page-${pageIndex(context, page)}`, lifecycle);
      if (key !== null && deliveredDocuments.size < 8) deliveredDocuments.add(key);
    });
    lifecycle.binding_state = 'installed';
  } catch {
    lifecycle.binding_state = 'unavailable';
  }
  await context.addInitScript({ content: REACT_COMMIT_HOOK_SOURCE });
  try {
    await use();
  } finally {
    const pages = context.pages().slice(0, 8);
    for (const [index, page] of pages.entries()) {
      try {
        const evidence = await page.evaluate(() => globalThis.__CODEVETTER_REACT_COMMITS__ ?? null);
        lifecycle.fallback_pages_evaluated += 1;
        retainDocument(documents, evidence, `fallback-${index}`, lifecycle);
      } catch {
        // Binding-delivered evidence from closed or replaced documents remains available.
      }
    }
    lifecycle.documents_delivered = deliveredDocuments.size;
    for (const [index, evidence] of [...documents.values()].slice(0, 8).entries()) {
      persist(outputDirectory, `document-${index}.json`, evidence, 64 * 1024);
    }
    lifecycle.completed = true;
    persist(outputDirectory, 'lifecycle.json', lifecycle, 8 * 1024);
  }
}

function retainDocument(documents, value, fallbackKey, lifecycle) {
  let evidence;
  try {
    evidence = sanitizePlaywrightReactDocument(value);
  } catch {
    lifecycle.invalid_payloads = Math.min(256, lifecycle.invalid_payloads + 1);
    return null;
  }
  const key = evidence.document_token ?? fallbackKey;
  if (!documents.has(key) && documents.size >= 8) {
    lifecycle.truncated = true;
    return null;
  }
  documents.set(key, evidence);
  return key;
}

function pageIndex(context, page) {
  const index = context.pages().indexOf(page);
  return index >= 0 && index < 8 ? index : 8;
}

function persist(outputDirectory, filename, value, byteLimit) {
  if (
    typeof outputDirectory !== 'string' ||
    !isAbsolute(outputDirectory) ||
    !/^(?:document-[0-7]|lifecycle)\.json$/.test(filename) ||
    !value ||
    typeof value !== 'object'
  ) {
    return;
  }
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > byteLimit) return;
  try {
    writeFileSync(resolve(outputDirectory, filename), serialized, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    // The parent treats missing or duplicate temporary evidence as an explicit gap.
  }
}
