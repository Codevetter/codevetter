import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

interface BenchmarkScenario {
  id: string;
  route: string;
  mockState: string;
  interactions: string[];
  assertions: string[];
  observationProfile: string;
  screenshotCheckpoints: string[];
}

describe('warm verification qualification boundary', () => {
  it('keeps the checked-in benchmark at exactly 20 meaningful deterministic scenarios', async () => {
    const manifestPath = path.resolve(
      process.cwd(),
      'tests/fixtures/warm-verification/benchmark-manifest.json'
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      scenarios: BenchmarkScenario[];
    };
    const ids = manifest.scenarios.map((scenario) => scenario.id);

    assert.equal(manifest.scenarios.length, 20);
    assert.equal(new Set(ids).size, ids.length);
    for (const scenario of manifest.scenarios) {
      assert.match(scenario.id, /^[a-z0-9]+(?:-[a-z0-9]+)+$/);
      assert.ok(scenario.route.startsWith('/'), `${scenario.id} must use direct route entry`);
      assert.ok(scenario.mockState.length > 0, `${scenario.id} must name deterministic state`);
      assert.ok(scenario.interactions.length >= 2, `${scenario.id} needs multiple interactions`);
      assert.ok(scenario.assertions.length > 0, `${scenario.id} needs scenario assertions`);
      assert.equal(scenario.observationProfile, 'strict-ui');
      assert.ok(
        scenario.screenshotCheckpoints.length > 0,
        `${scenario.id} needs a visual checkpoint`
      );
    }
  });

  it('keeps production warm execution disconnected from model and browser-agent modules', async () => {
    const directory = path.resolve(process.cwd(), 'src/lib/warm-verification');
    const productionFiles = (await readdir(directory))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort();
    const forbidden = /(?:anthropic|openai|openrouter|review-service|browser-agent|agent\/)/i;

    for (const file of productionFiles) {
      const source = await readFile(path.join(directory, file), 'utf8');
      const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(
        (match) => match[1] ?? ''
      );
      for (const specifier of specifiers) {
        assert.doesNotMatch(specifier, forbidden, `${file} imports a model-capable boundary`);
      }
    }
  });
});
