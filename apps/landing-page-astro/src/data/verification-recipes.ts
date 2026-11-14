// These examples exercise public synthetic fixtures, not product or agent success rates.
export const recipeSource = '28ee304927cd431966588136d099cf7659b03087';

export const verificationRecipes = [
  {
    task: 'enforce-tenant-resource-access',
    page: '/ai-code-validation',
    anchor: 'tenant-authorization',
    title: 'Validate authorization across a tenant boundary',
    requirement:
      'Ownership or administrator status grants access only within the caller’s tenant. Legitimate same-tenant access must continue to work.',
    exercise:
      'Call canAccess with user-1 in tenant-a and a resource owned by user-1 in tenant-b. A matching owner ID makes this a stronger negative case than an unrelated user: the result must still be false. Then check a same-tenant owner and a same-tenant administrator, both of which must receive true.',
    before: "return user.role === 'admin' || resource.ownerId === user.id;",
    after:
      "return user.tenantId === resource.tenantId &&\n  (user.role === 'admin' || resource.ownerId === user.id);",
    interpretation:
      'The baseline authorizes the cross-tenant owner. The supplied repair adds the tenant guard while retaining both allowed cases. The check runs the access helper itself; changing a comment or adding a frontend visibility condition would not satisfy this requirement.',
    limitation:
      'This fixture checks a pure helper, not an authenticated endpoint, database policy or every administrator case. In your app, add a request made with a real cross-tenant identity and verify that no protected data is returned. This example is not a security audit.',
  },
  {
    task: 'ignore-stale-search-response',
    page: '/verify-ai-generated-code',
    anchor: 'stale-search-response',
    title: 'Verify that stale search results cannot overwrite a newer request',
    requirement:
      'An older response must leave the active search state intact, while the active request can update its results and preserve the query.',
    exercise:
      'Start with requestId: 2, query: current and items: [current]. Apply a response for request 1 containing [stale], then independently apply a response for request 2 containing [fresh]. The stale branch must return the original state object and keep current; the active branch must return fresh and preserve the query.',
    before: 'return { ...state, items: response.items };',
    after:
      'if (response.requestId !== state.requestId) return state;\nreturn { ...state, items: response.items };',
    interpretation:
      'Both inputs are successful responses, so a happy-path-only test misses the defect. The supplied repair rejects the outdated identity before writing results. The driver chooses response order deterministically instead of relying on sleeps or a fast network to reproduce a race.',
    limitation:
      'The boundary is a state-transition helper. It does not launch a browser or issue concurrent HTTP requests. Add the real interaction that creates and propagates request identities when verifying a search UI; cancellation and component unmounting remain separate requirements.',
  },
  {
    task: 'await-transaction-commit',
    page: '/verify-ai-generated-code',
    anchor: 'await-durable-commit',
    title: 'Verify that a success result waits for transaction commit',
    requirement:
      'Persistence may report committed: true only after the commit promise settles. Preserve the written value and write-before-commit order.',
    exercise:
      'Use a transaction whose write resolves but whose commit promise is held open by the driver. Start persistValue(transaction, value-1), flush the driver’s two microtask checkpoints, and inspect whether the outer promise has settled. It must remain pending. Release commit, then check the success result and the exact call order: write(value-1), commit.',
    before: 'await transaction.write(value);\ntransaction.commit();\nreturn { committed: true };',
    after:
      'await transaction.write(value);\nawait transaction.commit();\nreturn { committed: true };',
    interpretation:
      'A check that awaits only the final result can see committed: true in both versions. Holding commit unresolved exposes the premature-success window. The known-good patch changes the waiting behavior, not the success shape or write value.',
    limitation:
      'This is an in-memory promise boundary, not a measurement of durable storage. Real database acceptance also needs a committed record read through the appropriate connection and a failure/recovery check. The fixture does not establish crash durability or isolation level.',
  },
  {
    task: 'rollback-failed-settings-update',
    page: '/verification-evidence-bundle',
    anchor: 'rollback-evidence',
    title: 'Keep rollback evidence separate from the original failure',
    requirement:
      'A failed settings commit must trigger rollback and keep the original commit failure as the rejection. A successful update must not roll back.',
    exercise:
      'Make commit throw a retained Error object and record write, commit and rollback calls. Require exactly that call order and compare the caught rejection with the original object. In a second transaction, allow commit to succeed and require saved: true with zero rollback calls.',
    before: 'await transaction.write(value);\nawait transaction.commit();\nreturn { saved: true };',
    after:
      'try {\n  await transaction.write(value);\n  await transaction.commit();\n  return { saved: true };\n} catch (error) {\n  await transaction.rollback();\n  throw error;\n}',
    interpretation:
      'The baseline already rejects on commit failure, so a test that merely expects a rejection is insufficient. The required check distinguishes a rejected transaction with no cleanup from one that ran rollback. Retain the call-order evidence alongside the failure rather than replacing the earlier record with a later green verdict.',
    limitation:
      'The driver makes rollback succeed. It does not test a second failure during rollback, storage state after partial writes, or crash recovery. The supplied patch therefore supports this bounded contract only; it is not a universal transaction implementation.',
  },
  {
    task: 'preserve-upstream-http-status',
    page: '/ai-code-review-vs-verification',
    anchor: 'upstream-status',
    title: 'Turn a suspicious HTTP status into a reproducible finding',
    requirement:
      'A response normalizer must retain a non-success upstream status without changing its body or headers.',
    exercise:
      'Pass normalizeResponse an upstream result with status 422, a retained headers object and a retained body object containing error: invalid. Require output.status === 422, output.body === body and output.headers === headers. The identity checks protect forwarding behavior as well as the status requirement.',
    before: 'return { status: 200, headers: response.headers, body: response.body };',
    after: 'return { status: response.status, headers: response.headers, body: response.body };',
    interpretation:
      'Review can flag the hardcoded 200 and explain why it looks risky. Execution narrows that concern to an observed contract failure: this 422 becomes 200 before repair, then stays 422 after repair. Keep the review finding and the check result as different evidence types. Neither needs to stand in for the other.',
    limitation:
      'The check invokes a normalizer, not a live HTTP server. It does not establish that a framework emits the returned status on the wire. Verify the real endpoint and its client-visible response when the changed boundary includes HTTP serialization or middleware.',
  },
  {
    task: 'forward-request-timeout',
    page: '/coding-agent-verification',
    anchor: 'timeout-forwarding',
    title: 'Connect an agent’s timeout change to the integration boundary',
    requirement:
      'The report wrapper must forward the caller’s timeout to the integration client while preserving the report path and response.',
    exercise:
      'Call fetchReport(client, report-7, 1500) with a client that captures its get arguments and returns a retained response object. Require options.timeoutMs === 1500, path === /reports/report-7 and the exact returned response object. This checks the receiving boundary rather than whether the wrapper merely accepts a timeout parameter.',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Preserve literal code from the pinned fixture.
    before: 'return client.get(`/reports/${reportId}`);',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Preserve literal code from the pinned fixture.
    after: 'return client.get(`/reports/${reportId}`, { timeoutMs });',
    interpretation:
      'The baseline exposes the parameter but drops it at the call. In an agent loop, return request-timeout-forwarded as the failing requirement; after a repair, rerun it with the path and response regressions. Changing a type declaration alone cannot make the captured option appear.',
    limitation:
      'Forwarding 1500 is not proof of a 1500 ms deadline, cancellation or socket cleanup. This driver never waits on a network. If the request must actually time out, add a controlled delayed integration using the real client’s timeout semantics and record its cancellation behavior.',
  },
  {
    task: 'reject-nan-retry-count',
    page: '/ai-code-validation',
    anchor: 'nan-retry-count',
    title: 'Validate a numeric retry count beyond typeof',
    requirement:
      'Reject NaN as a retry count; continue accepting zero and positive integers and rejecting strings.',
    exercise:
      'Call isRetryCount with Number.NaN, 0, 3 and the string 3. Require false, true, true and false respectively. Number.NaN is deliberately supplied as a JavaScript value: JSON cannot carry it as a numeric literal, so a JSON-only request fixture can accidentally erase the failing input before validation runs.',
    before: "return typeof value === 'number';",
    after: 'return Number.isInteger(value) && value >= 0;',
    interpretation:
      'The baseline accepts NaN because typeof NaN is number. The supplied repair applies a nonnegative-integer predicate and passes the declared controls. A zero case matters here: replacing the predicate with a truthiness test would reject a valid request to perform no retries.',
    limitation:
      'The recorded driver exercises these four values. Although the replacement predicate has broader semantics, this receipt does not record individual checks for Infinity, fractions, negative values or an application-specific maximum. Add those cases when the requirement includes them; do not infer full input coverage from one passing receipt.',
  },
  {
    task: 'update-real-parser-not-decoy',
    page: '/ai-code-validation',
    anchor: 'real-parser',
    title: 'Verify the real configuration parser, not a lookalike module',
    requirement:
      'The configuration parser must turn the string 0 into numeric zero, preserve positive parsing and invalid-input fallback, and leave the unrelated preview module unchanged.',
    exercise:
      "Import parseLimit from config-parser.ts. Require parseLimit('0', 25) to return 0, parseLimit('12', 25) to return 12 and invalid text to return 25. The driver also reads config-preview.ts and compares its complete content with the retained baseline. This makes an edit to the wrong lookalike file visible.",
    before: 'return Number(value) || fallback;',
    after: 'const parsed = Number(value);\nreturn Number.isNaN(parsed) ? fallback : parsed;',
    interpretation:
      'Both source files contain a similar truthiness fallback, but only one owns the requested numeric behavior. The known-good replacement edits config-parser.ts alone. This is a useful acceptance pattern for agent changes in repositories with similarly named implementations: select the actual caller boundary and name the unrelated source that must remain unchanged.',
    limitation:
      'The unchanged-file check is appropriate because this task explicitly preserves the preview. Do not copy byte-for-byte checks across unrelated refactors. This fixture does not validate all string grammar, empty strings or downstream consumers of the parsed value.',
  },
  {
    task: 'share-inflight-profile-load',
    page: '/coding-agent-verification',
    anchor: 'concurrent-profile-load',
    title: 'Verify shared in-flight work without caching results forever',
    requirement:
      'Concurrent calls for the same profile must share one operation. Once it settles, a later call must start a fresh load and preserve returned profile values.',
    exercise:
      'Start two loadProfile(profile-1, fetchProfile) calls together with Promise.all and count fetchProfile invocations. Require one invocation for that concurrent pair and profile-1 in both results. After settlement and the driver’s microtask checkpoint, make a third call and require exactly one additional invocation with the same returned profile ID.',
    before: 'inFlight.set(id, request);\ninFlight.delete(id);\nreturn request;',
    after:
      'inFlight.set(id, request);\nrequest.finally(() => inFlight.delete(id));\nreturn request;',
    interpretation:
      'Deleting the entry immediately makes both concurrent callers fetch independently. Keeping the entry forever would fix that symptom but fail settled-load-restarts. Feed both requirements back into the agent loop so the repair preserves the intended lifetime, rather than optimizing one assertion at the expense of freshness.',
    limitation:
      'This fixture uses successful in-memory promises for one profile. It does not exercise rejection cleanup, cross-key isolation, cancellation or a synchronous throw from the loader. In particular, do not treat the finally fragment as a complete error-handling recipe; use the separate rejection-and-retry example for that boundary.',
  },
  {
    task: 'clear-inflight-request-after-rejection',
    page: '/verification-evidence-bundle',
    anchor: 'retry-after-rejection',
    title: 'Prove recovery after a rejected cached request',
    requirement:
      'Remove a rejected in-flight load so a later call can retry; continue sharing an operation while it is pending and preserve the original failure.',
    exercise:
      'Start two loadOnce calls for profile before settling the first loader and require the same pending promise. Reject it with temporary, observe both rejections, then make a fresh call whose loader returns recovered. Require two total loader invocations, the recovered result and the retained failure message.',
    before: 'request.then(\n  () => inFlight.delete(key),\n  () => {}\n);\nreturn request;',
    after:
      'const tracked = request.finally(() => inFlight.delete(key));\ninFlight.set(key, tracked);\nreturn tracked;',
    interpretation:
      'The baseline deletes only after success, so it reuses an already rejected promise on the next attempt. The repair stores and returns the cleanup-tracked promise. A complete evidence record preserves the failed first attempt and the successful retry; publishing only the final recovered value would hide whether failure recovery was exercised.',
    limitation:
      'The driver checks a retained message, not exact error-object identity or real network recovery. It does not cover synchronous loader throws, eviction or simultaneous different keys. Use a controlled real integration failure when those are release requirements, and retain the missing checks as unverified.',
  },
];

const sourceRoot = `https://github.com/Codevetter/codevetter/tree/${recipeSource}/benchmarks/agent-tasks/sample/tasks`;
const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function recipesForPage(path: string) {
  const recipes = verificationRecipes.filter((recipe) => recipe.page === path);
  if (!recipes.length)
    return { markdown: '', html: '', navigationMarkdown: '', navigationHtml: '' };
  const introduction =
    'These worked recipes run public synthetic task fixtures. Each retained qualification repeats the intended baseline failure twice and the supplied known-good pass twice, with complete cleanup. The linked receipts were recorded on 14 November 2026 (UTC) with Node.js 24.22.2. They qualify the task and checks; they do not measure an agent, the installed app or production reliability. Qualification runs trusted corpus code without an operating-system sandbox.';
  const setup = `git clone https://github.com/Codevetter/codevetter.git codevetter-recipes\ncd codevetter-recipes\ngit switch --detach ${recipeSource}`;
  let markdown = `\n\n## Worked verification recipes\n\n${introduction}\n\nUse Node.js 24 or newer. These qualification drivers use Node built-ins; no package install, coding agent or provider key is required. In a fresh clone:\n\n\`\`\`sh\n${setup}\n\`\`\`\n\nThen run the task-specific command below from that checkout. Read the [corpus guide](/docs/development/agent-task-corpus) for the full contract.\n\n`;
  let html = `<h2 id="worked-verification-recipes">Worked verification recipes</h2><p>${introduction}</p><p>Use Node.js 24 or newer. These qualification drivers use Node built-ins; no package install, coding agent or provider key is required. In a fresh clone:</p><pre><code>${escapeHtml(setup)}</code></pre><p>Then run the task-specific command below from that checkout. Read the <a href="/docs/development/agent-task-corpus">corpus guide</a> for the full contract.</p><ul>${recipes.map((r) => `<li><a href="#${r.anchor}">${r.title}</a></li>`).join('')}</ul>`;
  for (const recipe of recipes) {
    const command = `node scripts/agent-task-corpus/qualify-cli.mjs --task ${recipe.task} --json`;
    const receipt = `/examples/verification-recipes/${recipe.task}.json`;
    markdown += `### ${recipe.title}\n\n**Requirement:** ${recipe.requirement}\n\n**Exercise the boundary:** ${recipe.exercise}\n\nStarting behavior:\n\n\`\`\`js\n${recipe.before}\n\`\`\`\n\nSupplied known-good replacement (relevant fragment):\n\n\`\`\`js\n${recipe.after}\n\`\`\`\n\n${recipe.interpretation}\n\n\`\`\`sh\n${command}\n\`\`\`\n\n[Inspect the pinned task, driver and acceptance checks](${sourceRoot}/${recipe.task}) · [Read the observed qualification receipt](${receipt}). Expected qualified: true, baseline.status: intended_failure, known_good.status: pass and cleanup.status: complete.\n\n**Boundary of this evidence:** ${recipe.limitation}\n\n`;
    html += `<section aria-labelledby="${recipe.anchor}"><h3 id="${recipe.anchor}">${recipe.title}</h3><p><strong>Requirement:</strong> ${recipe.requirement}</p><p><strong>Exercise the boundary:</strong> ${recipe.exercise}</p><p>Starting behavior:</p><pre><code>${escapeHtml(recipe.before)}</code></pre><p>Supplied known-good replacement (relevant fragment):</p><pre><code>${escapeHtml(recipe.after)}</code></pre><p>${recipe.interpretation}</p><pre><code>${escapeHtml(command)}</code></pre><p><a href="${sourceRoot}/${recipe.task}">Inspect the pinned task, driver and acceptance checks</a> · <a href="${receipt}">Read the observed qualification receipt</a>. Expected <code>qualified: true</code>, <code>baseline.status: intended_failure</code>, <code>known_good.status: pass</code> and <code>cleanup.status: complete</code>.</p><p><strong>Boundary of this evidence:</strong> ${recipe.limitation}</p></section>`;
  }
  const navigationMarkdown = `**Worked examples:** ${recipes.map((r) => `[${r.title}](https://codevetter.com${path}#${r.anchor})`).join(' · ')}\n\n`;
  const navigationHtml = `<nav aria-label="Worked examples"><p><strong>Worked examples:</strong> ${recipes.map((r) => `<a href="#${r.anchor}">${r.title}</a>`).join(' · ')}</p></nav>`;
  return { markdown, html, navigationMarkdown, navigationHtml };
}
