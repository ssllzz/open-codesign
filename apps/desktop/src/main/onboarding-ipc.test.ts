/**
 * Tests for settings IPC channel versioning.
 *
 * These tests verify that registerOnboardingIpc exposes only the versioned
 * v1 settings channels. v0.2 is the shipped IPC surface, so renderer/main IPC
 * drift should fail loudly instead of being hidden by unversioned compatibility
 * handlers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Collect registered channel names via a mock ipcMain.
const registeredChannels: string[] = [];

// Track handler implementations so we can call them directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

async function registerIpcForTest(): Promise<void> {
  registeredChannels.length = 0;
  handlers.clear();
  const { registerOnboardingIpc } = await import('./onboarding-ipc');
  registerOnboardingIpc();
}

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredChannels.push(channel);
      handlers.set(channel, fn);
    },
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  shell: { openPath: vi.fn() },
}));

// Stub Electron modules that electron-runtime would otherwise pull in.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false, getVersion: vi.fn(() => '0.0.0') },
  ipcMain: { handle: vi.fn() },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  shell: { openPath: vi.fn() },
}));

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
    transports: {
      file: { resolvePathFn: null, maxSize: 0, format: '' },
      console: { level: 'info', format: '' },
    },
    errorHandler: { startCatching: vi.fn() },
    eventLogger: { startLogging: vi.fn() },
    info: vi.fn(),
  },
}));

vi.mock('./config', () => ({
  defaultConfigDir: () => '/tmp/config',
  readConfig: vi.fn(async () => null),
  writeConfig: vi.fn(async () => {}),
}));

vi.mock('./keychain', () => ({
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
  decryptSecret: vi.fn((s: string) => s.replace('enc:', '')),
  maskSecret: vi.fn((s: string) => (s.length > 8 ? `${s.slice(0, 4)}***${s.slice(-4)}` : '***')),
  buildSecretRef: vi.fn((s: string) => ({
    ciphertext: `enc:${s}`,
    mask: s.length > 8 ? `${s.slice(0, 4)}***${s.slice(-4)}` : '***',
  })),
  migrateSecrets: vi.fn((cfg: { secrets?: Record<string, unknown> }) => ({
    config: cfg,
    changed: false,
  })),
}));

vi.mock('./storage-settings', () => ({
  buildAppPathsForLocations: vi.fn(() => ({})),
  getDefaultUserDataDir: vi.fn(() => '/tmp/data'),
  patchForStorageKind: vi.fn((kind: string, dir: string) => ({ [`${kind}Dir`]: dir })),
  readPersistedStorageLocations: vi.fn(async () => ({})),
  writeStorageLocations: vi.fn(async () => ({})),
}));

vi.mock('./logger', () => ({
  defaultLogsDir: () => '/tmp/logs',
  getLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('registerOnboardingIpc — channel versioning', () => {
  it('registers settings:v1:list-providers without the unversioned settings:list-providers shim', async () => {
    await registerIpcForTest();

    expect(registeredChannels).toContain('settings:v1:list-providers');
    expect(registeredChannels).not.toContain('settings:list-providers');
  }, 15_000);

  it('registers all settings v1 channels', async () => {
    await registerIpcForTest();

    const v1Channels = [
      'settings:v1:list-providers',
      'settings:v1:delete-provider',
      'settings:v1:set-active-provider',
      'settings:v1:get-paths',
      'settings:v1:choose-storage-folder',
      'settings:v1:open-folder',
      'settings:v1:reset-onboarding',
      'settings:v1:toggle-devtools',
    ];

    for (const ch of v1Channels) {
      expect(registeredChannels).toContain(ch);
    }
  }, 15_000);

  it('does not register unversioned settings channels', async () => {
    await registerIpcForTest();

    const unversionedChannels = [
      'settings:list-providers',
      'settings:add-provider',
      'settings:delete-provider',
      'settings:set-active-provider',
      'settings:get-paths',
      'settings:choose-storage-folder',
      'settings:open-folder',
      'settings:reset-onboarding',
      'settings:toggle-devtools',
    ];

    for (const ch of unversionedChannels) {
      expect(registeredChannels).not.toContain(ch);
    }
  });
});

describe('settings:v1:set-active-provider — payload validation', () => {
  it('rejects unknown fields instead of dropping them', async () => {
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 4,
      activeProvider: 'openai',
      activeModel: 'gpt-4o',
      secrets: { openai: { ciphertext: 'enc:sk-openai', mask: 'sk-***ai' } },
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          models: ['gpt-4o'],
        },
      },
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      baseUrls: {},
    });
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const handler = handlers.get('settings:v1:set-active-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        provider: 'openai',
        modelPrimary: 'gpt-4o',
        typoedField: true,
      }),
    ).rejects.toThrow(/unsupported field "typoedField"/);
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it('trims provider and model before persisting active settings', async () => {
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 4,
      activeProvider: 'openai',
      activeModel: 'gpt-4o',
      secrets: { openai: { ciphertext: 'enc:sk-openai', mask: 'sk-***ai' } },
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          wire: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          models: ['gpt-4o'],
        },
      },
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      baseUrls: {},
    });
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const handler = handlers.get('settings:v1:set-active-provider');
    if (!handler) throw new Error('handler missing');

    await handler({} as never, {
      provider: ' openai ',
      modelPrimary: ' gpt-4o-mini ',
    });

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('openai');
    expect(written?.activeModel).toBe('gpt-4o-mini');
  });
});

describe('config:v1:remove-provider — empty-state normalization', () => {
  it('returns provider:null after removing the last configured provider', async () => {
    const { hydrateConfig } = await import('@open-codesign/shared');
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce(
      hydrateConfig({
        version: 4,
        activeProvider: 'custom-only',
        activeModel: 'gpt-test',
        secrets: {
          'custom-only': { ciphertext: 'enc:sk-test', mask: 'sk-***test' },
        },
        providers: {
          'custom-only': {
            id: 'custom-only',
            name: 'Custom Only',
            wire: 'openai-chat',
            baseUrl: 'https://proxy.example.com/v1',
            models: ['gpt-test'],
          },
        },
      }),
    );
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:remove-provider');
    if (!handler) throw new Error('handler missing');

    await expect(handler({} as never, 'custom-only')).resolves.toMatchObject({
      hasKey: false,
      provider: null,
      modelPrimary: null,
      baseUrl: null,
    });
    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('');
    expect(written?.activeModel).toBe('');
  });
});

describe('settings:v1:reset-onboarding — empty-state normalization', () => {
  it('clears the active provider even when the old active provider is keyless', async () => {
    const { hydrateConfig } = await import('@open-codesign/shared');
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce(
      hydrateConfig({
        version: 4,
        activeProvider: 'ollama',
        activeModel: 'llama3.2',
        secrets: {},
        providers: {
          ollama: {
            id: 'ollama',
            name: 'Ollama (local)',
            wire: 'openai-chat',
            baseUrl: 'http://localhost:11434/v1',
            models: ['llama3.2'],
            capabilities: { supportsKeyless: true },
          },
        },
      }),
    );
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const reset = handlers.get('settings:v1:reset-onboarding');
    const getState = handlers.get('onboarding:get-state');
    if (!reset || !getState) throw new Error('handler missing');

    await reset({} as never);

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.activeProvider).toBe('');
    expect(written?.activeModel).toBe('');
    expect(written?.providers['ollama']).toBeDefined();
    expect(await getState({} as never)).toMatchObject({
      hasKey: false,
      provider: null,
      modelPrimary: null,
    });
  });
});

describe('config:v1 provider mutations — fail-fast key handling', () => {
  it('rejects custom provider creation with an empty API key before touching storage', async () => {
    const { buildSecretRef } = await import('./keychain');
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(buildSecretRef).mockClear();
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-empty',
        name: 'Custom Empty',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: '',
        models: ['gpt-test'],
      }),
    ).rejects.toThrow(/apiKey must be a non-empty string/);
    expect(buildSecretRef).not.toHaveBeenCalled();
  });

  it('rejects malformed custom-provider header maps instead of dropping bad entries', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-bad-headers',
        name: 'Custom Bad Headers',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-test',
        models: ['gpt-test'],
        httpHeaders: { 'x-ok': 'yes', 'x-bad': 42 },
        setAsActive: false,
      }),
    ).rejects.toThrow(/httpHeaders\.x-bad must be a string/);
  });

  it('rejects clearing a non-keyless provider secret instead of writing a broken config', async () => {
    const { hydrateConfig } = await import('@open-codesign/shared');
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot, registerOnboardingIpc } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce(
      hydrateConfig({
        version: 4,
        activeProvider: 'custom-required',
        activeModel: 'gpt-test',
        secrets: {
          'custom-required': { ciphertext: 'enc:sk-test', mask: 'sk-***test' },
        },
        providers: {
          'custom-required': {
            id: 'custom-required',
            name: 'Custom Required',
            wire: 'openai-chat',
            baseUrl: 'https://proxy.example.com/v1',
            models: ['gpt-test'],
          },
        },
      }),
    );
    await loadConfigOnBoot();
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:update-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-required',
        apiKey: '',
      }),
    ).rejects.toThrow(/Cannot clear API key/);
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it('rejects invalid provider updates instead of silently keeping old values', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:update-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-required',
        wire: 'not-a-wire',
      }),
    ).rejects.toThrow(/Unsupported wire/);
  });

  it('rejects invalid add-provider setAsActive instead of coercing to false', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-add',
        name: 'Custom Add',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-test',
        models: ['gpt-test'],
        setAsActive: 'yes',
      }),
    ).rejects.toThrow(/setAsActive must be a boolean/);
  });

  it('rejects missing add-provider setAsActive instead of defaulting to false', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-add',
        name: 'Custom Add',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-test',
        models: ['gpt-test'],
      }),
    ).rejects.toThrow(/setAsActive must be a boolean/);
  });

  it('rejects unknown provider mutation fields instead of dropping them', async () => {
    const { registerOnboardingIpc } = await import('./onboarding-ipc');
    registerOnboardingIpc();
    const handler = handlers.get('config:v1:add-provider');
    if (!handler) throw new Error('handler missing');

    await expect(
      handler({} as never, {
        id: 'custom-add',
        name: 'Custom Add',
        wire: 'openai-chat',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-test',
        models: ['gpt-test'],
        typoedField: 'would have been ignored',
      }),
    ).rejects.toThrow(/unsupported field "typoedField"/);
  });
});

describe('getApiKeyForProvider — API key retrieval', () => {
  it('returns the decrypted key when the provider secret exists in config', async () => {
    const { loadConfigOnBoot, getApiKeyForProvider } = await import('./onboarding-ipc');

    // Override readConfig to return a config with an anthropic secret.
    const { readConfig } = await import('./config');
    vi.mocked(readConfig).mockResolvedValueOnce({
      version: 4,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: { anthropic: { ciphertext: 'enc:sk-ant-test' } },
      providers: {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic Claude',
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          models: ['claude-sonnet-4-6'],
        },
      },
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      baseUrls: {},
    });

    await loadConfigOnBoot();
    const key = getApiKeyForProvider('anthropic');
    // decryptSecret mock strips the 'enc:' prefix.
    expect(key).toBe('sk-ant-test');
  });

  it('throws PROVIDER_KEY_MISSING when provider has no stored secret', async () => {
    const { getApiKeyForProvider } = await import('./onboarding-ipc');
    expect(() => getApiKeyForProvider('openai')).toThrow(/PROVIDER_KEY_MISSING|No API key stored/);
  });
});

describe('config:v1 custom provider keyless opt-in', () => {
  const provider = {
    id: 'custom-coproxy',
    name: 'CoProxy',
    wire: 'openai-responses',
    baseUrl: 'http://127.0.0.1:18537/v1',
    apiKey: '',
    keyless: true,
    models: ['gpt-6-astra'],
    setAsActive: true,
  };

  async function invoke(channel: string, payload: unknown) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error('handler missing');
    return handler({}, payload);
  }

  beforeEach(async () => {
    const { readConfig, writeConfig } = await import('./config');
    const { buildSecretRef } = await import('./keychain');
    const { loadConfigOnBoot } = await import('./onboarding-ipc');
    vi.mocked(readConfig).mockResolvedValueOnce(null);
    await loadConfigOnBoot();
    await registerIpcForTest();
    vi.mocked(writeConfig).mockClear();
    vi.mocked(buildSecretRef).mockClear();
  });

  it('creates an active keyless provider without storing a secret', async () => {
    const { writeConfig } = await import('./config');
    const { buildSecretRef } = await import('./keychain');
    await expect(invoke('config:v1:add-provider', provider)).resolves.toMatchObject({
      hasKey: true,
      provider: provider.id,
      modelPrimary: 'gpt-6-astra',
    });
    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.providers[provider.id]).toMatchObject({
      wire: 'openai-responses',
      models: ['gpt-6-astra'],
    });
    expect(written?.providers[provider.id]?.capabilities).toEqual({ supportsKeyless: true });
    expect(written?.secrets).toEqual({});
    expect(buildSecretRef).not.toHaveBeenCalled();
    await expect(invoke('settings:v1:list-providers', undefined)).resolves.toEqual([
      expect.objectContaining({
        provider: provider.id,
        hasKey: true,
        maskedKey: '',
      }),
    ]);
  });

  it('keeps strict creation defaults when keyless is absent', async () => {
    const { writeConfig } = await import('./config');
    const { keyless: _k, ...keyed } = provider;
    await expect(invoke('config:v1:add-provider', keyed)).rejects.toThrow(
      /apiKey must be a non-empty string/,
    );
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it('rejects malformed keyless flags', async () => {
    await expect(
      invoke('config:v1:add-provider', { ...provider, keyless: 'false' }),
    ).rejects.toThrow(/keyless must be a boolean/);
    await expect(
      invoke('config:v1:update-provider', { id: provider.id, keyless: 0 }),
    ).rejects.toThrow(/keyless must be a boolean/);
  });

  it('requires a stored or newly supplied key when switching back to keyed mode', async () => {
    const { writeConfig } = await import('./config');
    const { getCachedConfig } = await import('./onboarding/config-cache');
    await invoke('config:v1:add-provider', provider);
    vi.mocked(writeConfig).mockClear();
    await expect(
      invoke('config:v1:update-provider', {
        id: provider.id,
        keyless: false,
      }),
    ).rejects.toThrow(/No API key stored/);
    expect(writeConfig).not.toHaveBeenCalled();
    expect(getCachedConfig()?.providers[provider.id]?.capabilities?.supportsKeyless).toBe(true);
    await invoke('config:v1:update-provider', {
      id: provider.id,
      keyless: false,
      apiKey: ' sk-new ',
    });
    expect(
      getCachedConfig()?.providers[provider.id]?.capabilities?.supportsKeyless,
    ).toBeUndefined();
    expect(getCachedConfig()?.secrets[provider.id]?.ciphertext).toBe('enc:sk-new');
  });

  it('rejects models lists that are empty or contain blanks', async () => {
    await expect(invoke('config:v1:add-provider', { ...provider, models: [] })).rejects.toThrow(
      /models/,
    );
    await expect(
      invoke('config:v1:update-provider', { id: provider.id, models: ['  '] }),
    ).rejects.toThrow(/models/);
  });

  it('updates the models list on an existing provider', async () => {
    const { getCachedConfig } = await import('./onboarding/config-cache');
    await invoke('config:v1:add-provider', provider);
    await invoke('config:v1:update-provider', {
      id: provider.id,
      models: ['m1', 'm1', ' m2 '],
    });
    expect(getCachedConfig()?.providers[provider.id]?.models).toEqual(['m1', 'm2']);
  });
});

describe('provider CRUD preserves the imageGeneration section', () => {
  it('keeps imageGeneration settings when updating an unrelated provider field', async () => {
    const { hydrateConfig } = await import('@open-codesign/shared');
    const { readConfig, writeConfig } = await import('./config');
    const { loadConfigOnBoot } = await import('./onboarding-ipc');
    vi.mocked(writeConfig).mockClear();
    vi.mocked(readConfig).mockResolvedValueOnce(
      hydrateConfig({
        version: 4,
        activeProvider: 'volcano',
        activeModel: 'kimi-k2.8-preview',
        secrets: { volcano: { ciphertext: 'enc:k', mask: 'k***' } },
        providers: {
          volcano: {
            id: 'volcano',
            name: '火山',
            wire: 'anthropic',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
            models: ['kimi-k2.8-preview'],
          },
        },
        imageGeneration: {
          schemaVersion: 1,
          enabled: true,
          provider: 'openai',
          credentialMode: 'custom',
          model: 'gpt-image-2',
          quality: 'high',
          size: '1536x1024',
          outputFormat: 'png',
          apiKey: { ciphertext: 'enc:img-key', mask: 'sk-***img' },
        },
      }),
    );
    await loadConfigOnBoot();
    await registerIpcForTest();
    const handler = handlers.get('config:v1:update-provider');
    if (!handler) throw new Error('handler missing');

    await handler({} as never, { id: 'volcano', reasoningLevel: 'low' });

    const written = vi.mocked(writeConfig).mock.calls.at(-1)?.[0];
    expect(written?.imageGeneration?.apiKey?.ciphertext).toBe('enc:img-key');
    expect(written?.imageGeneration?.enabled).toBe(true);
  });
});
