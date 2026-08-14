'use strict';

const Module = require('node:module');
const path = require('node:path');

const repositoryRoot = process.env.CODEVETTER_REPOSITORY_ROOT;
const target = process.env.CODEVETTER_PLAYWRIGHT_TARGET;
const wrapperPath = path.resolve(__dirname, 'playwright-react-wrapper.cjs');
const originalLoad = Module._load;
let selectedPlaywright = null;

Module._load = function codevetterReactLoad(request, parent, isMain) {
  if (request === '@playwright/test' && selectedParent(parent?.filename)) {
    selectedPlaywright = originalLoad.call(this, request, parent, isMain);
    return originalLoad.call(this, wrapperPath, module, false);
  }
  if (
    request === 'codevetter-playwright-react-base-cjs' &&
    parent?.filename === wrapperPath &&
    selectedPlaywright
  ) {
    return selectedPlaywright;
  }
  return originalLoad.call(this, request, parent, isMain);
};

function selectedParent(filename) {
  if (
    typeof repositoryRoot !== 'string' ||
    typeof target !== 'string' ||
    target.length === 0 ||
    path.isAbsolute(target) ||
    target.split('/').includes('..') ||
    typeof filename !== 'string'
  ) {
    return false;
  }
  return path.resolve(filename) === path.resolve(repositoryRoot, target);
}
