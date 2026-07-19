# Coding Conventions

**Analysis Date:** 2026-04-05

## Naming Patterns

**Files:**
- Components: PascalCase with `.tsx` extension (e.g., `agent-card.tsx`, `review-form.tsx`)
- Hooks: kebab-case prefixed with `use-` (e.g., `use-review.ts`, `use-chat-stream.ts`)
- Utilities/services: camelCase with descriptive names (e.g., `tauri-ipc.ts`, `review-service.ts`, `orchestrator.ts`)
- Type definitions: PascalCase with `Record` suffix for database records (e.g., `UserRecord`, `SessionRecord`, `ReviewFindingRecord`)
- Test files: Same name as source with `.test.ts` suffix (e.g., `controlPlane.test.ts`, `agentDetection.test.ts`)

**Functions:**
- camelCase throughout (e.g., `computeScore`, `determineReviewAction`, `detectAgent`, `loadReviewConfig`)
- Utility functions: camelCase, often with clear action verb prefix (e.g., `getLocalDiff`, `saveReview`, `isTauriAvailable`)
- Helper functions: Private with `_` prefix not used; instead marked with comments or placed in private scopes
- Private async functions in classes: camelCase (e.g., `githubAppJwt`, `githubFetch`)

**Variables:**
- camelCase (e.g., `statusConfig`, `adapterIcons`, `defaultStatusConfig`, `isAgentAuthored`)
- Constants (immutable module-level): UPPER_SNAKE_CASE (e.g., `SEVERITY_WEIGHTS`, `STORAGE_KEY`, `PROVIDER_PRESETS`)
- Unused parameters: Prefixed with `_` to avoid linting warnings (e.g., `_` for unused function parameters)

**Types:**
- Interfaces: PascalCase (e.g., `AgentCardProps`, `ReviewConfig`, `GitHubClientConfig`, `ReviewProgress`)
- Type aliases: PascalCase for unions and complex types (e.g., `ReviewAction`, `ReviewMode`, `ReviewSeverity`)
- Input/payload types: Suffix with `Input` for function parameters (e.g., `CreateSessionInput`, `UpsertGithubUserInput`)
- Database record types: Suffix with `Record` (e.g., `SessionRecord`, `WorkspaceRecord`, `AuditLogRecord`)

## Code Style

**Formatting:**
- No Prettier configuration found — code follows standard TypeScript/React conventions
- Indentation: 2 spaces (observed in all files)
- Line endings: LF (standard)
- Quotes: Double quotes in JSX, single quotes in TypeScript strings (mixed, not enforced)

**Linting:**
- Tool: ESLint (flat config in `eslint.config.js`)
- Language: TypeScript with `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`
- Target: ES2022 modules
- Key rules:
  - `@typescript-eslint/no-unused-vars`: warn (unused params with `_` prefix ignored)
  - `@typescript-eslint/no-explicit-any`: warn (discouraged but allowed)
  - `@typescript-eslint/no-use-before-define`: warn (functions/classes allowed before definition, variables not)
  - `no-console`: off (console logging allowed)
- Max warnings on lint-staged: 50 per file

## Import Organization

**Order:**
1. Node.js built-in modules (e.g., `import https from 'https'`, `import { describe, it } from 'node:test'`)
2. Third-party packages (e.g., `react`, `@tauri-apps/api`, `@playwright/test`)
3. Type imports from packages (e.g., `import type { ClassValue } from 'clsx'`)
4. Internal workspace packages (e.g., `@code-reviewer/shared-types`, `@code-reviewer/review-core`)
5. Local imports using path aliases (e.g., `@/lib/tauri-ipc`, `@/components/sidebar`)

**Path Aliases:**
- `@/` resolves to `src/` in frontend apps (e.g., `@/lib/utils`, `@/components/ui`)
- No aliases in packages or workers — use relative imports (`../')` or direct exports from `index.ts`
- Barrel files used in `packages/*/src/index.ts` to export public APIs

**Type-safe imports:**
- Use `import type` for type-only imports to avoid circular dependencies (e.g., `import type { ReviewConfig } from '@/lib/review-service'`)
- Mixed imports allowed when necessary (e.g., importing both types and values)

## Error Handling

**Patterns:**
- Custom error classes with descriptive names (e.g., `GitHubApiError` with optional `statusCode` property)
- Errors thrown with meaningful messages (e.g., `throw new GitHubApiError('Unexpected repository payload from GitHub.')`)
- Try-catch used for async operations and error recovery (e.g., in `loadCustomRules`, errors silently caught and fallback returned)
- Guard clauses to validate types before operations (e.g., `if (!isObject(value))` before casting)

**Validation:**
- Type guards as named functions (e.g., `isObject(value)` — returns `value is Record<string, unknown>`)
- Inline fallback values on type coercion (e.g., `toNumber(value, fallback = 0)` with default 0)
- Null/undefined checks explicit (e.g., `value === null || value === undefined`)
- Array validation with `Array.isArray()` before spreading or iterating

## Logging

**Framework:** `console` directly (no logger abstraction)

**Patterns:**
- No logging in pure logic functions (e.g., `computeScore`, `detectAgent` functions are silent)
- Console logging allowed (ESLint rule `no-console: off`)
- Error context logged when available (e.g., GitHub API errors include message and status code)
- No structured logging or debug namespace observed

## Comments

**When to Comment:**
- JSDoc-style comments for exported functions and types (e.g., `/** Review service — orchestrates the review pipeline in the webview. */`)
- Inline comments for non-obvious logic (e.g., `// If Tauri APIs simply aren't available (SSR / browser dev), throw a distinguishable error`)
- Section separators using special markers (e.g., `// ─── Helpers ────────────────────────────────────`, `// ═══════════════════════════════════════════════════════`)

**JSDoc/TSDoc:**
- Minimal JSDoc usage — only on public exports
- Function signatures usually self-documenting (TypeScript types are the primary documentation)
- Parameter descriptions included when logic is complex (e.g., `@param args?: Record<string, unknown>`)

## Function Design

**Size:** 
- Functions kept under 50 lines; longer logic refactored into smaller functions
- Example: `reviewLocalDiff` is ~40 lines, broken into config loading + gateway invocation stages
- Utility functions often 1-10 lines (e.g., `cn()` function is 3 lines)

**Parameters:** 
- Avoid long parameter lists; use configuration objects instead
- Example: `detectAgent` accepts single options object: `{ authorLogin?, prBody?, headRef?, commitMessages? }`
- Optional parameters marked with `?` in types
- Callbacks passed as function parameters (e.g., `onProgress?: (p: ReviewProgress) => void`)

**Return Values:** 
- Return early on validation failure (guard clauses)
- Return objects for multiple related values (e.g., `ReviewResult` type with `score`, `findings`, `summaryMarkdown`)
- Return `Promise<T>` for async operations with explicit type parameter
- Return `null` or `undefined` for optional results (e.g., `loadReviewConfig(): ReviewConfig | null`)

## Module Design

**Exports:**
- Prefer named exports over default exports (observed in most files)
- Type exports use `export type` for clarity
- Public interfaces prefixed in packages (e.g., `ControlPlaneDatabase` interface in `controlPlane.ts`)
- No wildcard exports (`export *`) except in barrel `index.ts` files

**Barrel Files:**
- Used in packages: `packages/shared-types/src/index.ts` imports and re-exports from multiple files
- Used in apps: Limited barrel usage; components imported directly
- Purpose: Simplify public API of packages and reduce import path depth

**Internal organization:**
- Database classes (e.g., `InMemoryControlPlaneDatabase`, `D1ControlPlane`) implement common interface `ControlPlaneDatabase`
- Utility functions grouped in service files (e.g., `review-service.ts` has `loadReviewConfig`, `saveReviewConfig`, `reviewLocalDiff`)
- No class instance exports; stateless utility functions preferred

## Async/Await Patterns

- Async functions always return `Promise<T>` with explicit type
- Try-catch for error handling (alternative: `.catch()` chains not observed)
- Promise.all() used for parallel operations (e.g., in `getOrganizationSnapshot`)
- No callback hell; promises chained with `await` in async contexts
- React hooks: `useCallback` wraps async logic to memoize function references

---

*Convention analysis: 2026-04-05*
