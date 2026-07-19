# Testing Patterns

**Analysis Date:** 2026-04-05

## Test Framework

**Runner:**
- Node.js built-in `node:test` module for unit/integration tests
- Playwright for E2E tests
- Config: `.planning/codebase/TESTING.md` documents both patterns

**Assertion Library:**
- `node:assert/strict` for Node.js tests
- `@playwright/test` for E2E tests with built-in `expect()`

**Run Commands:**
```bash
npm test                    # Run all workspace tests (packages only via npm run -w)
npm run -w packages/db test # Run db package tests (Node.js test)
npm test -w apps/desktop   # Run Playwright E2E tests (if configured)
```

**Watch mode:**
- Not configured for Node.js tests
- Playwright has `--watch` flag not actively used in this codebase

**Coverage:**
- No code coverage tool detected (no vitest, jest, or c8 config)
- Coverage not enforced

## Test File Organization

**Location:**
- Co-located with source files (adjacent in same directory)
- Example: `packages/db/src/controlPlane.test.ts` sits alongside `packages/db/src/controlPlane.ts`

**Naming:**
- Pattern: `{sourceFile}.test.ts`
- Examples: `controlPlane.test.ts`, `agentDetection.test.ts`

**Directory structure:**
- E2E tests separated: `apps/desktop/tests/` for Playwright specs
- Unit tests: Same directory as source code
- Screenshot artifacts: `apps/desktop/tests/screenshots/`

## Test Structure

**Suite organization (Node.js):**
```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('InMemoryControlPlaneDatabase', () => {
  let db: ControlPlaneDatabase;

  beforeEach(() => {
    db = new InMemoryControlPlaneDatabase();
  });

  describe('users', () => {
    it('upsert + get by github ID', async () => {
      const user = await db.upsertUserFromGithub({...});
      assert.equal(user.githubUserId, '1001');
      // More assertions
    });
  });
});
```

**Patterns:**
- `describe()` groups related tests (nested allowed)
- `it()` individual test case
- `beforeEach()` setup before each test
- No `afterEach()` observed (tests use new instances)
- Async/await for async operations

## Mocking

**Framework:** 
- No mocking library detected (not using sinon, jest.mock, or similar)
- Mocking achieved via dependency injection and test doubles

**Patterns (from observed tests):**
```typescript
// Use constructor injection for testability
const db = new InMemoryControlPlaneDatabase(); // In-memory double for tests
const db = new D1ControlPlane(env.DB);        // Real D1 DB for integration

// Test data creation inline
const user = await db.upsertUserFromGithub({
  githubUserId: '1001',
  githubLogin: 'alice',
  displayName: 'Alice',
});

// No mocks for network calls in unit tests
// Integration tests use real GitHub client with test data
```

**What to Mock:**
- External APIs: Avoided in unit tests; use in-memory implementations instead
- Database: Use `InMemoryControlPlaneDatabase` for tests, `D1ControlPlane` for integration
- Tauri IPC: `isTauriAvailable()` returns false in non-Tauri environments; tests handle gracefully

**What NOT to Mock:**
- Core business logic (e.g., `detectAgent`, `computeScore` — test directly)
- Type conversions (e.g., `toNumber()`, `toOptionalString()` — test with real data)
- Database layer: Use in-memory or test instance, not mocks

## Fixtures and Factories

**Test Data:**
- Inline creation in tests (no separate fixture files observed)
- Example from `controlPlane.test.ts`:
```typescript
const user = await db.upsertUserFromGithub({
  githubUserId: '1001',
  githubLogin: 'alice',
  displayName: 'Alice',
});
```

- Fixtures for detector: Multiple test cases exercise different input combinations:
```typescript
it('detects bot accounts', () => {
  const result = detectAgent({ authorLogin: 'renovate[bot]' });
  assert.equal(result.isAgentAuthored, true);
});

it('detects Claude Code PR body marker', () => {
  const result = detectAgent({ prBody: 'Some PR\n\nGenerated with [Claude Code](...)' });
  assert.equal(result.isAgentAuthored, true);
});
```

**Location:**
- No shared fixture directory; data created locally in each test
- Type definitions from `@code-reviewer/shared-types` used for test data

## Coverage

**Requirements:** 
- No coverage requirement enforced
- No coverage thresholds in configuration

**View Coverage:**
- Not configured
- Would need to add vitest/jest/c8 if coverage tracking desired

## Test Types

**Unit Tests (Node.js):**
- Scope: Single function or class method
- Approach: Test with varied inputs, assert output correctness
- Examples:
  - `controlPlane.test.ts`: Tests in-memory database CRUD operations (users, sessions, workspaces)
  - `agentDetection.test.ts`: Tests agent detection logic with multiple PR metadata patterns
  - Functions tested: `detectAgent()`, `upsertUserFromGithub()`, `createSession()`, etc.

**Integration Tests:**
- Not explicitly separated; database tests (`controlPlane.test.ts`) act as integration tests
- Real database classes (`D1ControlPlane`) tested separately (likely via CI/CD in deployed environments)
- No integration test fixtures or setup files observed

**E2E Tests (Playwright):**
- Framework: Playwright
- Config: `apps/desktop/playwright.config.ts` (testDir: `./tests/e2e`)
- Scope: Full application flows
- Approach: Navigate pages, click buttons, verify UI state
- Examples:
  - App loads without crashing
  - All routes render without error boundaries
  - Navigation works (5 routes tested)
  - Board page has expected sections (Agent Squad, Kanban columns)
  - Dialog opens on button click

## Common Patterns

**Async Testing (Node.js):**
```typescript
it('upsert + get by github ID', async () => {
  const user = await db.upsertUserFromGithub({
    githubUserId: '1001',
    githubLogin: 'alice',
    displayName: 'Alice',
  });
  assert.equal(user.githubUserId, '1001');
});
```
- Functions return `Promise<T>`; use `await` in test
- No timeout configuration needed (handled by runner)

**Error Testing:**
```typescript
it('returns undefined for unknown github ID', async () => {
  const result = await db.getUserByGithubId('nonexistent');
  assert.equal(result, undefined);
});
```
- No explicit error throwing tested; instead test null/undefined returns
- Guard clauses validate preconditions in functions

**State Verification (E2E):**
```typescript
test("Test 2: All pages render without errors", async ({ page }) => {
  const routes = [
    { path: "/", name: "home" },
    { path: "/workspaces", name: "workspaces" },
    // ...
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await page.waitForTimeout(500);
    const errorCount = await page.locator("text=Something went wrong").count();
    expect(errorCount).toBe(0);
  }
});
```
- Playwright selectors find elements by text or role
- Wait for elements before assertions (async UI rendering)
- Screenshots captured on failure for debugging

## Test Isolation

- Each test creates fresh database instance via `beforeEach()`
- No shared state between tests
- Database transactions not used; in-memory instance discarded after each test

## Documentation

**Test Comments:**
- Playwright test headers explain purpose (e.g., "These tests verify the CodeVetter desktop app UI against the Vite dev server")
- Node.js tests self-documenting via descriptive `it()` names
- No detailed comments in test bodies

---

*Testing analysis: 2026-04-05*
