import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ResolveActiveApiKeyDeps, ResolveCredentialForProviderDeps } from './resolve-api-key';
import { resolveActiveApiKey, resolveCredentialForProvider } from './resolve-api-key';

function makeDeps(overrides: Partial<ResolveActiveApiKeyDeps> = {}): ResolveActiveApiKeyDeps {
  return {
    getApiKeyForProvider: vi.fn().mockReturnValue('stored-key'),
    ...overrides,
  };
}

describe('resolveActiveApiKey', () => {
  it('returns the stored API key', async () => {
    const deps = makeDeps();
    const key = await resolveActiveApiKey('anthropic', deps);
    expect(key).toBe('stored-key');
    expect(deps.getApiKeyForProvider).toHaveBeenCalledWith('anthropic');
  });

  it('wraps key-missing error in CodesignError(PROVIDER_AUTH_MISSING) with cause', async () => {
    const underlying = new Error('no key stored');
    const deps = makeDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw underlying;
      }),
    });
    // Keyless support is the caller's job: IPC handlers use the explicit
    // credential resolver before reading key storage. This helper never
    // silently drops the error.
    try {
      await resolveActiveApiKey('custom-proxy', deps);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('PROVIDER_AUTH_MISSING');
      expect((err as CodesignError).message).toBe('no key stored');
      expect((err as CodesignError).cause).toBe(underlying);
    }
  });

  it('passes through pre-existing CodesignError without re-wrapping', async () => {
    const original = new CodesignError('custom code', 'PROVIDER_KEY_MISSING');
    const deps = makeDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw original;
      }),
    });
    // If the underlying helper already threw a structured error with its own
    // code (e.g. PROVIDER_KEY_MISSING vs the keychain-read failures above),
    // we must not clobber it — let callers observe the original code.
    await expect(resolveActiveApiKey('anthropic', deps)).rejects.toBe(original);
  });

  it('wraps non-Error rejections with a generic diagnostic message', async () => {
    const deps = makeDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw 'broken string throw';
      }),
    });
    try {
      await resolveActiveApiKey('some-proxy', deps);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('PROVIDER_AUTH_MISSING');
      expect((err as CodesignError).message).toContain('some-proxy');
    }
  });
});

describe('resolveCredentialForProvider', () => {
  function keylessDeps(
    overrides: Partial<ResolveCredentialForProviderDeps> = {},
  ): ResolveCredentialForProviderDeps {
    return {
      getApiKeyForProvider: vi.fn().mockReturnValue('stored-key'),
      hasApiKeyForProvider: vi.fn().mockReturnValue(true),
      ...overrides,
    };
  }

  it('keyless provider without a stored secret returns an empty bearer without reading key storage', async () => {
    const deps = keylessDeps({
      hasApiKeyForProvider: vi.fn().mockReturnValue(false),
    });
    await expect(resolveCredentialForProvider('local-gateway', true, deps)).resolves.toBe('');
    expect(deps.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it('keyless provider with a stored secret still surfaces secret read failures', async () => {
    const original = new Error('keychain decrypt failed');
    const deps = keylessDeps({
      hasApiKeyForProvider: vi.fn().mockReturnValue(true),
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw original;
      }),
    });
    await expect(resolveCredentialForProvider('custom-proxy', true, deps)).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_MISSING',
      cause: original,
    });
  });

  it('keyless: propagates unrelated CodesignError codes verbatim', async () => {
    const original = new CodesignError('downstream blew up', 'PROVIDER_ERROR');
    const deps = keylessDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw original;
      }),
    });
    await expect(resolveCredentialForProvider('local-gateway', true, deps)).rejects.toBe(original);
  });

  it('non-keyless: re-throws PROVIDER_KEY_MISSING so the user sees "add your key"', async () => {
    const deps = keylessDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw new CodesignError('no secret stored', 'PROVIDER_KEY_MISSING');
      }),
    });
    await expect(resolveCredentialForProvider('anthropic', false, deps)).rejects.toMatchObject({
      code: 'PROVIDER_KEY_MISSING',
    });
  });

  it('happy path: returns the stored key when no error is thrown', async () => {
    const deps = keylessDeps();
    await expect(resolveCredentialForProvider('anthropic', false, deps)).resolves.toBe(
      'stored-key',
    );
  });
});
