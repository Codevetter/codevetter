# Repo Unpack expansion — 2026-10-02

Prepared **100 additional developer-tool and framework repositories**, taking the
local corpus from 85 to **185**. The 85 baseline records remain byte-identical.
This report describes local preparation; it does not establish public deployment.

## What the expansion contributes

Each addition has eight source-analysis sections, a pinned upstream commit,
Git-tracked line citations, an agent handoff, a recorded analysis call and a
bounded review receipt. Source findings describe implementation branches and
test assertion boundaries. They are useful context for selecting verification;
they do not establish that upstream tests pass or that agents save time.

The reports contain **6,793 cited claims**. Supervisors screened
all prose and independently source-checked **2,746**
indexed claims while tracing **473** flows. The pinned
anchors in all 100 review receipts were also checked against Git blobs
(8,344 distinct anchors per receipt, summed).
These are bounded checks; full semantic correctness remains unestablished.

## Verification perspective

- Jest collection can report passed entries without executing their bodies.
- DOM Testing Library waitFor accepts a nonthrowing return; returning false is not a failing assertion.
- Playwright file filtering precedes loading, while later filters do not prove skipped module loading.
- Vitest related-test selection can select zero tests; retained workers require state and invalidation checks.
- Stryker incremental reuse without coverage assumes prior results reusable; fresh execution uses a different selection path.
- MobX retention evidence intentionally excludes a property that also fails in a plain React control.

These examples are independently inspected static branches, not executed
reproductions. Exact commits, anchors, qualifications and additional findings
are in the [machine-readable evidence](repo-unpack-expansion-2026-10-02.json).
The [testing-speed study](../performance/testing-speed-study-2026-10-02.md)
turns selection, reuse and isolation findings into experiments that preserve
acceptance evidence. No acceleration from those experiments is claimed here.

## Report corrections and recording limits

Comparing captured original model messages with final reports found
**16 claim-text edits** and
**70 source-only claim edits**.
These counts describe edited report claims, not upstream bugs, model accuracy
or causal productivity improvement. Claim indices preserve surgical lookup.

The local citation validator initially rejected valid GitHub line-range syntax.
That validator defect was fixed; its format rejections are not model errors.
Original reports and repair receipts remain available in private scratch.

All **100 analysis calls** have recorded identities and verified
stored-stream hashes. **5** were recovered after the parent supplied
an unsupported recorder-source value. Their original analysis runtimes are
unknown; recovery duration is not substituted for analysis duration.
Known analysis runtime sums to **41,146.920 seconds**.
This sum is neither elapsed batch time nor saved agent time. Dollar cost and
agent time saved are unknown. Collection-stage runtime totals 6,937.954
seconds across recorded stages. Unrecorded collection-stage timings: **1**.
The median recorded collection stage is 50.793 seconds.
These stages include collection orchestration and are not isolated engine-CPU
benchmarks. Profile collection before claiming a faster context path.
Collection logs are separate from Fleet model-call receipts. Upstream code,
dependencies and tests were not
executed. Local exporter, citation, build and output-contract checks are separate.

## CodeVetter value remains a measured question

The related testing-scope invocation omitted the exact new citation test and
returned unrelated candidates. Its agent-reported assessment is did_not_help,
with a verified receipt identity. This negative observation remains separate
from canonical verdicts and external Codex source-analysis logs.

The [43-project performance trial](../performance/fleet-performance-skill-trial-2026-10-02.md)
supplied investigation leads, but established no paired optimization speedup
or with-versus-without agent benefit. This expansion provides more grounded
context and explicit verification boundaries; it does not close that value gap.

## Repository inventory

The commit link identifies inspected source. Checked counts are independently
source-checked report claims, not every claim screened and not executed tests.

| Repository | Claims | Source-checked | Flows |
| --- | ---: | ---: | ---: |
| [honojs/hono](https://github.com/honojs/hono/tree/f23b146afcec63606144cde50b5fbd360dd60238) | 93 | 42 | 4 |
| [fastify/fastify](https://github.com/fastify/fastify/tree/19d5be0daf1c0daace758efe3ea788f924ca1224) | 80 | 40 | 4 |
| [nestjs/nest](https://github.com/nestjs/nest/tree/35142c3eca8edaaf6abc5984d915da2fbd458aa2) | 83 | 38 | 3 |
| [remix-run/react-router](https://github.com/remix-run/react-router/tree/a6090382ed467b5a2d46c8de1a13b331f14959f8) | 81 | 28 | 3 |
| [withastro/astro](https://github.com/withastro/astro/tree/4c1470a7f907fe678ef5e7dceaa972ca83d297da) | 87 | 33 | 4 |
| [angular/angular](https://github.com/angular/angular/tree/831cb13e1c6e5ff17da23273109772c2b088302e) | 93 | 25 | 4 |
| [solidjs/solid](https://github.com/solidjs/solid/tree/b25c557754f2ced0d86490e6dbfded9b1745b663) | 98 | 18 | 3 |
| [preactjs/preact](https://github.com/preactjs/preact/tree/45728eb4315bcb22c5d50b8fec0bbac419eaa799) | 98 | 32 | 4 |
| [QwikDev/qwik](https://github.com/QwikDev/qwik/tree/8eb4589be115eb8f2dabfd12c107dcc23647caec) | 92 | 19 | 3 |
| [nuxt/nuxt](https://github.com/nuxt/nuxt/tree/3fde4d625cc353e83ac10f6b75db8ca480167be4) | 98 | 22 | 3 |
| [remix-run/remix](https://github.com/remix-run/remix/tree/27bd7a4401594ec1acbe30ee3937518832270a30) | 103 | 45 | 3 |
| [redwoodjs/redwood](https://github.com/redwoodjs/redwood/tree/a7852fb92d0e4ac2bcce1d9a755717ba6cf53ffd) | 93 | 21 | 3 |
| [blitz-js/blitz](https://github.com/blitz-js/blitz/tree/b18f81873e641934043f791fec06e22f5fe5a86e) | 93 | 35 | 4 |
| [adonisjs/core](https://github.com/adonisjs/core/tree/e1b2357eacc2e8e72e0815abbc5f2e94264acffb) | 97 | 25 | 3 |
| [elysiajs/elysia](https://github.com/elysiajs/elysia/tree/e037eca710e7ad193be09cc6615ab0dbe54af914) | 64 | 29 | 5 |
| [koajs/koa](https://github.com/koajs/koa/tree/824c1cf8de9a91a2941973b25dc8a3d3029b9e4f) | 64 | 21 | 3 |
| [keystonejs/keystone](https://github.com/keystonejs/keystone/tree/1a8f2b7fae39ea5dac415745caea4f766109e669) | 64 | 25 | 4 |
| [payloadcms/payload](https://github.com/payloadcms/payload/tree/e6cd442f40563b2dd95cebcc6a3ffaa2dbbc68f2) | 64 | 13 | 3 |
| [strapi/strapi](https://github.com/strapi/strapi/tree/93476f908c08d6d3d5215c06483829e3c6da1b32) | 64 | 28 | 5 |
| [meteor/meteor](https://github.com/meteor/meteor/tree/ac3f471f4af5c8aec737e20ccd168bfc7cc1a49e) | 64 | 19 | 3 |
| [rollup/rollup](https://github.com/rollup/rollup/tree/a77225f4b9ef88f20d26a32a3dc70954241f3fb6) | 64 | 15 | 3 |
| [parcel-bundler/parcel](https://github.com/parcel-bundler/parcel/tree/59484858a1a0bcbb71f74088956bb437a2db6505) | 64 | 16 | 3 |
| [web-infra-dev/rspack](https://github.com/web-infra-dev/rspack/tree/179a0934f3091463419827fc2767af07b2fd38ed) | 64 | 30 | 4 |
| [rolldown/rolldown](https://github.com/rolldown/rolldown/tree/37d60ff510b4b326f4b587c27f28c606d76373e8) | 64 | 10 | 3 |
| [swc-project/swc](https://github.com/swc-project/swc/tree/3c46139b86b27a7b3fefcf7b19ca07a63de9db0a) | 64 | 19 | 3 |
| [oxc-project/oxc](https://github.com/oxc-project/oxc/tree/7f65b757df7c3225320d8f7e051e64873f80f988) | 64 | 28 | 5 |
| [eslint/eslint](https://github.com/eslint/eslint/tree/bc51eee6e3e816622b2dd1bc08acb9cfb2d3a6a7) | 64 | 15 | 3 |
| [stylelint/stylelint](https://github.com/stylelint/stylelint/tree/bc06c7cdb1413de3d8dc939b33af138ab7e59df1) | 64 | 35 | 5 |
| [typescript-eslint/typescript-eslint](https://github.com/typescript-eslint/typescript-eslint/tree/effa652828afba0aa730f106cb326c54a97ccfb5) | 64 | 20 | 3 |
| [babel/babel](https://github.com/babel/babel/tree/7c1dcfac003791a7fee733ed13851a5cac1ccf1c) | 64 | 22 | 3 |
| [postcss/postcss](https://github.com/postcss/postcss/tree/7ac902664902289ea0cb9d6b1096b81e8d33bbf5) | 64 | 32 | 5 |
| [pnpm/pnpm](https://github.com/pnpm/pnpm/tree/b2ef6cb63b8b7cb93d6b57f0d2efedf25d7c1385) | 64 | 14 | 3 |
| [yarnpkg/berry](https://github.com/yarnpkg/berry/tree/e4e423a1eb117b5129f20ac626a03eb7a97aedff) | 64 | 17 | 3 |
| [npm/cli](https://github.com/npm/cli/tree/b317f16c80df02ea3628cfa77170d5ae9b59720c) | 64 | 33 | 7 |
| [lerna/lerna](https://github.com/lerna/lerna/tree/ce3e38f2889b26573f1b38cfb487546903292158) | 64 | 15 | 3 |
| [nrwl/nx](https://github.com/nrwl/nx/tree/bedd602304d762fd160b5f2a6a81990aa1903ccb) | 64 | 16 | 3 |
| [vercel/turborepo](https://github.com/vercel/turborepo/tree/2540ee1d740bb96bf249459a7957ef4b380c9e43) | 64 | 47 | 6 |
| [microsoft/rushstack](https://github.com/microsoft/rushstack/tree/1e18b16f029299f53a966878aff2ce187dd65a51) | 64 | 21 | 3 |
| [changesets/changesets](https://github.com/changesets/changesets/tree/c73949ba7b3160a4aa5729223335c190de1528f8) | 64 | 45 | 6 |
| [semantic-release/semantic-release](https://github.com/semantic-release/semantic-release/tree/e8c2436e5704a6d1fa5b4aa69238f50edbe586bf) | 64 | 23 | 3 |
| [vitest-dev/vitest](https://github.com/vitest-dev/vitest/tree/4ee66c021e0592c886dbab727f0f8da9366f99ab) | 64 | 13 | 4 |
| [microsoft/playwright](https://github.com/microsoft/playwright/tree/b630e71fcda7885885c459bcbb88e5bfa7c0a1ac) | 64 | 36 | 7 |
| [cypress-io/cypress](https://github.com/cypress-io/cypress/tree/7d987f04740f8f5388ac3116e8ef7957373ead14) | 64 | 13 | 3 |
| [jestjs/jest](https://github.com/jestjs/jest/tree/61050e9323e742539dc2360236671110e37329e6) | 64 | 13 | 3 |
| [testing-library/react-testing-library](https://github.com/testing-library/react-testing-library/tree/20ce75f2907ca0e5c5a8ae595c0e9a4e368c7800) | 64 | 53 | 6 |
| [testing-library/dom-testing-library](https://github.com/testing-library/dom-testing-library/tree/6049cc0bc7cf2201625c476c95fa6299d0e2fa8b) | 64 | 49 | 6 |
| [mswjs/msw](https://github.com/mswjs/msw/tree/6d6aef1640ace2ce2bd90252c71bdbc53262efd3) | 64 | 12 | 3 |
| [avajs/ava](https://github.com/avajs/ava/tree/bbfd946322fdeca2b547a691d947fb4e18c0c67f) | 64 | 17 | 3 |
| [mochajs/mocha](https://github.com/mochajs/mocha/tree/79db2ee53b863813b97bf2a74cafa1599115c074) | 64 | 32 | 6 |
| [jasmine/jasmine](https://github.com/jasmine/jasmine/tree/390d31e48106dd0d0b6dbcf5cf9071650fb2b4bf) | 64 | 13 | 3 |
| [chaijs/chai](https://github.com/chaijs/chai/tree/d86de2a9519bdd0d89aa64c9fbcc0e880513b153) | 64 | 17 | 4 |
| [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer/tree/2e45a3af43231cd658285e4da5e7f53e40f24edf) | 64 | 38 | 7 |
| [webdriverio/webdriverio](https://github.com/webdriverio/webdriverio/tree/dbf0f497130676040ce4212d9cf6459adfe16c42) | 64 | 14 | 3 |
| [storybookjs/storybook](https://github.com/storybookjs/storybook/tree/dc9b30e8fd8a71383ec01b9510f38bee51457e8a) | 64 | 15 | 3 |
| [chromaui/chromatic-cli](https://github.com/chromaui/chromatic-cli/tree/9e2606a2dbc11bcd07e7e451431432e32de0224b) | 64 | 34 | 8 |
| [pact-foundation/pact-js](https://github.com/pact-foundation/pact-js/tree/18f30a1aa44a948b3249a72879da3cff26c42d12) | 64 | 15 | 3 |
| [stryker-mutator/stryker-js](https://github.com/stryker-mutator/stryker-js/tree/f2a49ff02437e3b7fe2682dba808ac93039895bf) | 64 | 12 | 3 |
| [dubzzz/fast-check](https://github.com/dubzzz/fast-check/tree/ecf7193810d1057253808105444e147d948051a1) | 64 | 46 | 7 |
| [istanbuljs/nyc](https://github.com/istanbuljs/nyc/tree/908620475199fa7b9ea0ea8b21d6d8ad6921e3ae) | 64 | 17 | 3 |
| [gotestyourself/gotestsum](https://github.com/gotestyourself/gotestsum/tree/3cf14356a16c7931cfeacd7dfee585527618df3d) | 64 | 9 | 3 |
| [TanStack/query](https://github.com/TanStack/query/tree/29859ae60c8dca0a5cdbf8abccc775b655cf43e2) | 64 | 47 | 9 |
| [TanStack/router](https://github.com/TanStack/router/tree/1f0f20a3206a28365d74fd2485b9a8eedbf74dd0) | 64 | 12 | 3 |
| [TanStack/table](https://github.com/TanStack/table/tree/23f21c194e6eba2e7f0321e817104d6e118d6141) | 64 | 12 | 3 |
| [reduxjs/redux](https://github.com/reduxjs/redux/tree/56abca4749921d68f40cda20afd2043af9751f72) | 64 | 48 | 8 |
| [reduxjs/redux-toolkit](https://github.com/reduxjs/redux-toolkit/tree/e7a8b318df28aaf50ced1e65cd4636b7508263b2) | 64 | 13 | 3 |
| [pmndrs/zustand](https://github.com/pmndrs/zustand/tree/d7a5583cffd80af515f7dfb69583c95cbdc9e2ce) | 64 | 19 | 4 |
| [pmndrs/jotai](https://github.com/pmndrs/jotai/tree/6abd0ae3365e02ab432fba4b6e8e6f00aafbf508) | 64 | 54 | 9 |
| [pmndrs/valtio](https://github.com/pmndrs/valtio/tree/26d8ca8cb6e5bb3b9516d429e50bc5aab1f42e0d) | 64 | 16 | 4 |
| [mobxjs/mobx](https://github.com/mobxjs/mobx/tree/60be47cab0926d12f22449ec6c809fb5ec6601c4) | 64 | 50 | 9 |
| [immerjs/immer](https://github.com/immerjs/immer/tree/061c2425e1c9dff89e4e4189d42af1b7839dfe0a) | 64 | 19 | 3 |
| [ReactiveX/rxjs](https://github.com/ReactiveX/rxjs/tree/54796b38a57e6309f9861e174737479bb3f63f61) | 64 | 23 | 4 |
| [effect-ts/effect](https://github.com/effect-ts/effect/tree/6389d9ac64c0f62ccc8b575fb9afc65fc104e814) | 64 | 20 | 3 |
| [gcanti/fp-ts](https://github.com/gcanti/fp-ts/tree/c0a6472121c67a2b083e62fcff13e7d022e39d8f) | 64 | 52 | 9 |
| [date-fns/date-fns](https://github.com/date-fns/date-fns/tree/717ce0a807ea4c6b540d015b5c408723175b2838) | 64 | 20 | 4 |
| [iamkun/dayjs](https://github.com/iamkun/dayjs/tree/436bde0bcded312781cbe45dc2b0ef079a36d8e3) | 64 | 54 | 9 |
| [moment/luxon](https://github.com/moment/luxon/tree/f427515a38f6a671f8de663e6bcc040ed81f114e) | 64 | 11 | 3 |
| [motiondivision/motion](https://github.com/motiondivision/motion/tree/f5838ce47b323ce2713cb2effc5afaa5b6120a44) | 64 | 16 | 4 |
| [remeda/remeda](https://github.com/remeda/remeda/tree/9955bb0eca98cc5d1bbb17dc4314dd38a10a28d5) | 64 | 53 | 10 |
| [unjs/ofetch](https://github.com/unjs/ofetch/tree/1dbc37fd1ceab832fc7c90cad81b1091c95ba563) | 64 | 25 | 3 |
| [sindresorhus/got](https://github.com/sindresorhus/got/tree/e1d87d2ced01d5b7d855a7dc8b091bf7b014a1e4) | 64 | 14 | 4 |
| [pydantic/pydantic](https://github.com/pydantic/pydantic/tree/29933d1c8cfc882a7640f4d831b09381b39aa311) | 64 | 13 | 3 |
| [pydantic/pydantic-settings](https://github.com/pydantic/pydantic-settings/tree/5927b441848c330853eac74c82358bc283cd3640) | 64 | 58 | 10 |
| [pallets/werkzeug](https://github.com/pallets/werkzeug/tree/594452f6a4fe4de38a544962fbf04bfc9d37fbc2) | 64 | 21 | 4 |
| [encode/starlette](https://github.com/encode/starlette/tree/4e7fc04e5f2c69f60e418ff2107d0f6d9a0fe423) | 64 | 59 | 11 |
| [encode/httpx](https://github.com/encode/httpx/tree/b5addb64f0161ff6bfe94c124ef76f6a1fba5254) | 64 | 12 | 3 |
| [pytest-dev/pytest](https://github.com/pytest-dev/pytest/tree/2887015cade4757385308e7a7d8083557fc637e2) | 64 | 63 | 12 |
| [python-poetry/poetry](https://github.com/python-poetry/poetry/tree/d4fd21e4711ae948f04e18a1736d9ee85b590e87) | 64 | 20 | 4 |
| [pypa/hatch](https://github.com/pypa/hatch/tree/7c26ebeaf8b83f5f0374a2545bb15e36c87db0d0) | 64 | 12 | 3 |
| [pypa/pip](https://github.com/pypa/pip/tree/a7002c9771a6c3f0317a4e6b9fbdcd22e643f7b6) | 64 | 20 | 4 |
| [pypa/virtualenv](https://github.com/pypa/virtualenv/tree/571bc2041dae5ecbd250d82ec7ef482cfd3c3b69) | 64 | 61 | 12 |
| [sqlalchemy/sqlalchemy](https://github.com/sqlalchemy/sqlalchemy/tree/890d62f4337fe4af1afc36358fb536cf754fc231) | 64 | 16 | 3 |
| [diesel-rs/diesel](https://github.com/diesel-rs/diesel/tree/5cdf54e1434b87084a4630c100249f1028f3e32d) | 64 | 64 | 12 |
| [SeaQL/sea-orm](https://github.com/SeaQL/sea-orm/tree/db40a19a7bde7be8e1c4b346b1b70d72e87f0245) | 64 | 11 | 3 |
| [tokio-rs/tokio](https://github.com/tokio-rs/tokio/tree/2746c3ae26f8ac0af6023843a7f23d419c334efe) | 64 | 20 | 4 |
| [tokio-rs/axum](https://github.com/tokio-rs/axum/tree/f8b02f22cf10bee707bda19b58265b9e33677535) | 64 | 64 | 13 |
| [actix/actix-web](https://github.com/actix/actix-web/tree/30c831fce5328ccf916bea77e59ce6419b457e39) | 64 | 19 | 3 |
| [gin-gonic/gin](https://github.com/gin-gonic/gin/tree/43fe48e8a0f44af783116cdb010725e6bb50255f) | 64 | 28 | 4 |
| [labstack/echo](https://github.com/labstack/echo/tree/99c395d846e079d4cffd29de9298d1dd829e8b04) | 64 | 61 | 13 |
| [gofiber/fiber](https://github.com/gofiber/fiber/tree/0923873f4a1bd7e5582ab0d6729cf04e683db2ae) | 64 | 21 | 5 |
| [spf13/cobra](https://github.com/spf13/cobra/tree/adbc8813901bba65827259daa8e22ff94ec1f30e) | 64 | 26 | 3 |

## Surgical access

The evidence JSON maps each repository to its Fleet run ID, exact source and
report hashes, changed claim indices, bounded review and full private event
log path. Stored streams can be sanitized or truncated; the full private raw
event log has a separate hash. Public exports omit the local clone path and
retain the SHA of the exact private pre-export corpus record.

```sh
node ~/.local/bin/fleet-skill-run show <analysis-run-id> --json
node ~/.local/bin/fleet-skill-run output <analysis-run-id> --stream stdout --json
python3 skills/codevetter-evaluate/scripts/invoke.py --show f5a595df-5706-4dca-82e4-1878e3998ed9
```

Private batch artifacts live under `artifacts/unpack-expansion-2026-10-02/`.
[Issue #350](https://github.com/Codevetter/codevetter/issues/350) tracks this
expansion; [issue #348](https://github.com/Codevetter/codevetter/issues/348)
tracks skills, invocation visibility and measured product value.
