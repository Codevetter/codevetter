import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { parseVerifyConfig, type VerifyConfig, VerifyConfigValidationError } from './config';

export const VERIFY_CONFIG_RELATIVE_PATH = '.codevetter/verify.yaml';
export const MAX_VERIFY_CONFIG_BYTES = 262_144;

export interface VerifyConfigSnapshot {
  config: VerifyConfig;
  configPath: string;
  hash: string;
  sourceBytes: number;
}

export class VerifyConfigLoadError extends Error {
  readonly code: 'missing' | 'oversized' | 'yaml' | 'schema' | 'unsafe_path';
  readonly details: string[];

  constructor(
    code: VerifyConfigLoadError['code'],
    message: string,
    details: string[] = [],
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'VerifyConfigLoadError';
    this.code = code;
    this.details = details;
  }
}

export class VerifyConfigLoader {
  readonly #repoRoot: string;
  #cached: VerifyConfigSnapshot | undefined;

  private constructor(repoRoot: string) {
    this.#repoRoot = repoRoot;
  }

  static async create(repoRoot: string): Promise<VerifyConfigLoader> {
    return new VerifyConfigLoader(await realpath(repoRoot));
  }

  async load(): Promise<VerifyConfigSnapshot> {
    const configPath = path.join(this.#repoRoot, VERIFY_CONFIG_RELATIVE_PATH);
    let source: string;
    try {
      source = await readFile(configPath, 'utf8');
    } catch (error) {
      throw new VerifyConfigLoadError(
        'missing',
        `Verification config not found at ${VERIFY_CONFIG_RELATIVE_PATH}`,
        [],
        { cause: error }
      );
    }

    const sourceBytes = Buffer.byteLength(source);
    if (sourceBytes > MAX_VERIFY_CONFIG_BYTES) {
      throw new VerifyConfigLoadError(
        'oversized',
        `Verification config is ${sourceBytes} bytes; maximum is ${MAX_VERIFY_CONFIG_BYTES}`
      );
    }

    const hash = createHash('sha256').update(source).digest('hex');
    if (this.#cached?.hash === hash) {
      return this.#cached;
    }

    const document = parseDocument(source, {
      merge: false,
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
    const yamlErrors = document.errors.map((entry) => entry.message);
    if (yamlErrors.length > 0) {
      throw new VerifyConfigLoadError(
        'yaml',
        'Verification config is not valid strict YAML',
        yamlErrors
      );
    }
    if (document.warnings.length > 0) {
      throw new VerifyConfigLoadError(
        'yaml',
        'Verification config uses unsupported ambiguous YAML',
        document.warnings.map((entry) => entry.message)
      );
    }

    let value: unknown;
    try {
      value = document.toJS({ maxAliasCount: 0 });
    } catch (error) {
      throw new VerifyConfigLoadError('yaml', 'Verification config aliases are not supported', [], {
        cause: error,
      });
    }

    let config: VerifyConfig;
    try {
      config = parseVerifyConfig(value);
    } catch (error) {
      if (error instanceof VerifyConfigValidationError) {
        throw new VerifyConfigLoadError(
          'schema',
          error.message,
          error.issues.map((entry) => `${entry.path}: ${entry.message}`),
          { cause: error }
        );
      }
      throw error;
    }

    await this.#assertConfiguredPathsStayWithinRepo(config);
    this.#cached = Object.freeze({
      config: deepFreeze(config),
      configPath,
      hash,
      sourceBytes,
    });
    return this.#cached;
  }

  invalidate(): void {
    this.#cached = undefined;
  }

  async #assertConfiguredPathsStayWithinRepo(config: VerifyConfig): Promise<void> {
    const candidates = [
      config.target.cwd,
      config.retention.directory,
      ...config.scenarioModules,
      ...Object.values(config.authProfiles).map((profile) => profile.storageState),
    ];
    const escaped = candidates.filter((candidate) => {
      const resolved = path.resolve(this.#repoRoot, candidate);
      return resolved !== this.#repoRoot && !resolved.startsWith(`${this.#repoRoot}${path.sep}`);
    });
    if (escaped.length > 0) {
      throw new VerifyConfigLoadError(
        'unsafe_path',
        'Verification config contains paths outside the target repository',
        escaped
      );
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
