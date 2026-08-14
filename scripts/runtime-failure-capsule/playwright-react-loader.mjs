import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = process.env.CODEVETTER_REPOSITORY_ROOT;
const target = process.env.CODEVETTER_PLAYWRIGHT_TARGET;
const wrapperUrl = new URL('./playwright-react-wrapper.mjs', import.meta.url).href;
let selectedPlaywrightUrl = null;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@playwright/test' && selectedParent(context.parentURL)) {
    selectedPlaywrightUrl = (await nextResolve(specifier, context)).url;
    return { url: wrapperUrl, shortCircuit: true };
  }
  if (
    specifier === 'codevetter-playwright-react-base' &&
    context.parentURL === wrapperUrl &&
    selectedPlaywrightUrl
  ) {
    return { url: selectedPlaywrightUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

function selectedParent(parentUrl) {
  if (
    typeof repositoryRoot !== 'string' ||
    typeof target !== 'string' ||
    target.length === 0 ||
    target.startsWith('/') ||
    target.split('/').includes('..') ||
    typeof parentUrl !== 'string' ||
    !parentUrl.startsWith('file:')
  ) {
    return false;
  }
  try {
    return resolvePath(fileURLToPath(parentUrl)) === resolvePath(repositoryRoot, target);
  } catch {
    return false;
  }
}
