import { describe, expect, it } from 'vitest';
import {
  ConfigV4Schema,
  detectWireFromBaseUrl,
  hydrateConfig,
  migrateLegacyToV4,
  migrateV3ToV4,
  type ProviderEntry,
  parseConfigFlexible,
  resolveProviderCapabilities,
  StoredDesignSystem,
  toPersistedV4,
} from './config';

const V4_ENTRY: ProviderEntry = {
  id: 'volcano',
  name: '火山',
  wire: 'anthropic',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
  models: ['kimi-k2.8-preview'],
};

describe('config v4 schema', () => {
  it('parses a minimal v4 config', () => {
    const parsed = ConfigV4Schema.parse({
      version: 4,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: { volcano: V4_ENTRY },
    });
    expect(parsed.version).toBe(4);
    expect(parsed.activeProvider).toBe('volcano');
    expect(parsed.providers['volcano']?.models).toEqual(['kimi-k2.8-preview']);
  });

  it('rejects a provider entry with an empty models list', () => {
    expect(() =>
      ConfigV4Schema.parse({
        version: 4,
        activeProvider: 'volcano',
        activeModel: 'm',
        secrets: {},
        providers: { volcano: { ...V4_ENTRY, models: [] } },
      }),
    ).toThrow();
  });

  it('accepts off as an explicit provider reasoning override', () => {
    const parsed = ConfigV4Schema.parse({
      version: 4,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: { volcano: { ...V4_ENTRY, reasoningLevel: 'off' } },
    });
    expect(parsed.providers['volcano']?.reasoningLevel).toBe('off');
  });

  it('does not treat an explicit off override as reasoning support', () => {
    const caps = resolveProviderCapabilities('volcano', {
      wire: 'openai-chat',
      reasoningLevel: 'off',
    });
    expect(caps.supportsReasoning).toBe(false);
  });

  it('rejects unknown wire values', () => {
    expect(() =>
      ConfigV4Schema.parse({
        version: 4,
        activeProvider: 'x',
        activeModel: 'm',
        secrets: {},
        providers: { x: { ...V4_ENTRY, id: 'x', wire: 'bogus' } },
      }),
    ).toThrow();
  });

  it('rejects unknown top-level fields instead of stripping them', () => {
    expect(() =>
      ConfigV4Schema.parse({
        version: 4,
        activeProvider: 'volcano',
        activeModel: 'kimi-k2.8-preview',
        secrets: {},
        providers: { volcano: V4_ENTRY },
        provider: 'volcano',
      }),
    ).toThrow();
  });

  it('rejects unknown provider entry fields instead of stripping them', () => {
    expect(() =>
      ConfigV4Schema.parse({
        version: 4,
        activeProvider: 'volcano',
        activeModel: 'kimi-k2.8-preview',
        secrets: {},
        providers: {
          volcano: { ...V4_ENTRY, apiKey: 'sk-should-not-live-here' },
        },
      }),
    ).toThrow();
  });

  it('accepts the explicit no-active-provider empty state', () => {
    const parsed = ConfigV4Schema.parse({
      version: 4,
      activeProvider: '',
      activeModel: '',
      secrets: {},
      providers: {},
    });
    expect(parsed.activeProvider).toBe('');
    expect(parsed.activeModel).toBe('');
  });

  it('rejects one-sided active provider/model state', () => {
    expect(() =>
      ConfigV4Schema.parse({
        version: 4,
        activeProvider: 'volcano',
        activeModel: '',
        secrets: {},
        providers: { volcano: V4_ENTRY },
      }),
    ).toThrow(/activeModel/);

    expect(() =>
      ConfigV4Schema.parse({
        version: 4,
        activeProvider: '',
        activeModel: 'm',
        secrets: {},
        providers: {},
      }),
    ).toThrow(/activeModel/);
  });

  it('rejects active providers that have no provider entry', () => {
    expect(() =>
      ConfigV4Schema.parse({
        version: 4,
        activeProvider: 'custom-missing',
        activeModel: 'gpt-test',
        secrets: { 'custom-missing': { ciphertext: 'plain:sk-test' } },
        providers: {},
      }),
    ).toThrow(/activeProvider/);
  });

  it('parses schema-versioned image generation settings', () => {
    const parsed = ConfigV4Schema.parse({
      version: 4,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: { volcano: V4_ENTRY },
      imageGeneration: {
        schemaVersion: 1,
        enabled: true,
        provider: 'openrouter',
        credentialMode: 'custom',
        model: 'openai/gpt-5.4-image-2',
        apiKey: { ciphertext: 'plain:sk-test', mask: 'sk-***test' },
      },
    });
    expect(parsed.imageGeneration?.enabled).toBe(true);
    expect(parsed.imageGeneration?.quality).toBe('high');
    expect(parsed.imageGeneration?.size).toBe('1536x1024');
  });

  it('rejects chatgpt-codex as an image generation provider', () => {
    expect(() =>
      ConfigV4Schema.parse({
        version: 4,
        activeProvider: 'volcano',
        activeModel: 'kimi-k2.8-preview',
        secrets: {},
        providers: { volcano: V4_ENTRY },
        imageGeneration: {
          schemaVersion: 1,
          enabled: true,
          provider: 'chatgpt-codex',
          credentialMode: 'inherit',
          model: 'gpt-image-2',
        },
      }),
    ).toThrow();
  });

  it('round-trips a tlsRejectUnauthorized provider through toPersistedV4', () => {
    const cfg = ConfigV4Schema.parse({
      version: 4,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: {
        volcano: { ...V4_ENTRY, tlsRejectUnauthorized: true },
      },
    });
    const persisted = toPersistedV4(hydrateConfig(cfg));
    expect(persisted.providers['volcano']?.tlsRejectUnauthorized).toBe(true);
    expect(persisted.version).toBe(4);
  });
});

describe('migrateV3ToV4', () => {
  it('drops builtin-preset entries and the chatgpt-codex entry, pruning their secrets', () => {
    const v4 = migrateV3ToV4({
      version: 3,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: {
        anthropic: { ciphertext: 'a' },
        'chatgpt-codex': { ciphertext: 'c' },
        volcano: { ciphertext: 'v' },
      },
      providers: {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic Claude',
          builtin: true,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-6',
        },
        'chatgpt-codex': {
          id: 'chatgpt-codex',
          name: 'ChatGPT',
          builtin: false,
          wire: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api/codex',
          defaultModel: 'gpt-5.2-codex',
          modelsHint: ['gpt-5.2-codex'],
        },
        volcano: {
          id: 'volcano',
          name: '火山',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          defaultModel: 'kimi-k2.8-preview',
        },
      },
    });
    expect(Object.keys(v4.providers)).toEqual(['volcano']);
    expect(Object.keys(v4.secrets)).toEqual(['volcano']);
  });

  it('falls activeProvider back to the first surviving provider with a secret', () => {
    const v4 = migrateV3ToV4({
      version: 3,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: { volcano: { ciphertext: 'v' } },
      providers: {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic Claude',
          builtin: true,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-6',
        },
        volcano: {
          id: 'volcano',
          name: '火山',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          defaultModel: 'kimi-k2.8-preview',
        },
      },
    });
    expect(v4.activeProvider).toBe('volcano');
    expect(v4.activeModel).toBe('kimi-k2.8-preview');
  });

  it('lands in the empty state when every entry is removed', () => {
    const v4 = migrateV3ToV4({
      version: 3,
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-6',
      secrets: { anthropic: { ciphertext: 'a' } },
      providers: {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic Claude',
          builtin: true,
          wire: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-6',
        },
      },
    });
    expect(v4.activeProvider).toBe('');
    expect(v4.activeModel).toBe('');
    expect(v4.providers).toEqual({});
    expect(v4.secrets).toEqual({});
  });

  it('folds defaultModel and modelsHint into the manual models list', () => {
    const v4 = migrateV3ToV4({
      version: 3,
      activeProvider: 'gw',
      activeModel: 'm1',
      secrets: {},
      providers: {
        gw: {
          id: 'gw',
          name: 'GW',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://gw.example.com/v1',
          defaultModel: 'm1',
          modelsHint: ['m2', 'm1'],
        },
      },
    });
    expect(v4.providers['gw']?.models).toEqual(['m1', 'm2']);
  });

  it('drops an imageGeneration section pinned to chatgpt-codex', () => {
    const base = {
      version: 3 as const,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: {
        volcano: {
          id: 'volcano',
          name: '火山',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          defaultModel: 'kimi-k2.8-preview',
        },
      },
    };
    const dropped = migrateV3ToV4({
      ...base,
      imageGeneration: {
        schemaVersion: 1,
        enabled: true,
        provider: 'chatgpt-codex',
        credentialMode: 'inherit',
        model: 'gpt-image-2',
      },
    });
    expect(dropped.imageGeneration).toBeUndefined();

    const kept = migrateV3ToV4({
      ...base,
      imageGeneration: {
        schemaVersion: 1,
        enabled: true,
        provider: 'openai',
        credentialMode: 'inherit',
        model: 'gpt-image-2',
      },
    });
    expect(kept.imageGeneration?.provider).toBe('openai');
  });

  it('removes requiresApiKey while keeping keyless capability semantics', () => {
    const v4 = migrateV3ToV4({
      version: 3,
      activeProvider: 'local',
      activeModel: 'llama3.2',
      secrets: {},
      providers: {
        local: {
          id: 'local',
          name: 'Local',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'llama3.2',
          requiresApiKey: false,
        },
      },
    });
    expect(v4.providers['local']?.capabilities?.supportsKeyless).toBe(true);
    expect(v4.providers['local'] !== undefined && 'requiresApiKey' in v4.providers['local']).toBe(
      false,
    );
  });
});

describe('migrateLegacyToV4', () => {
  it('lands in the empty state and preserves the design system', () => {
    const legacy = {
      version: 2 as const,
      provider: 'anthropic' as const,
      modelPrimary: 'claude-sonnet-4-6',
      secrets: { anthropic: { ciphertext: 'abc==' } },
      baseUrls: {},
      designSystem: StoredDesignSystem.parse({
        rootPath: '/tmp/ds',
        summary: 'tokens',
        extractedAt: '2026-01-01T00:00:00Z',
      }),
    };
    const v4 = migrateLegacyToV4(legacy);
    expect(v4.version).toBe(4);
    expect(v4.activeProvider).toBe('');
    expect(v4.providers).toEqual({});
    expect(v4.secrets).toEqual({});
    expect(v4.designSystem?.summary).toBe('tokens');
  });
});

describe('parseConfigFlexible', () => {
  it('accepts a v4 object as-is', () => {
    const raw = {
      version: 4,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: { volcano: V4_ENTRY },
    };
    const out = parseConfigFlexible(raw);
    expect(out.version).toBe(4);
  });

  it('migrates a v3 object transparently', () => {
    const out = parseConfigFlexible({
      version: 3,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: {
        volcano: {
          id: 'volcano',
          name: '火山',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          defaultModel: 'kimi-k2.8-preview',
        },
      },
    });
    expect(out.version).toBe(4);
    expect(out.activeProvider).toBe('volcano');
    expect(out.providers['volcano']?.models).toEqual(['kimi-k2.8-preview']);
  });

  it('migrates a v1 object transparently into the empty state', () => {
    const out = parseConfigFlexible({
      version: 1,
      provider: 'openrouter',
      modelPrimary: 'anthropic/claude-sonnet-4.6',
      secrets: { openrouter: { ciphertext: 'x' } },
    });
    expect(out.version).toBe(4);
    expect(out.activeProvider).toBe('');
  });

  it('throws on schema mismatch', () => {
    expect(() => parseConfigFlexible({ provider: 'nope', modelPrimary: 'x' })).toThrow();
  });
});

describe('detectWireFromBaseUrl', () => {
  it('routes Anthropic URLs to the anthropic wire', () => {
    expect(detectWireFromBaseUrl('https://api.anthropic.com')).toBe('anthropic');
  });
  it('routes Azure to openai-responses', () => {
    expect(detectWireFromBaseUrl('https://org.openai.azure.com/openai')).toBe('openai-responses');
  });
  it('does not classify arbitrary hosts containing the Azure domain string as Azure', () => {
    expect(detectWireFromBaseUrl('https://openai.azure.com.evil.test/v1')).toBe('openai-chat');
  });
  it('defaults to openai-chat', () => {
    expect(detectWireFromBaseUrl('https://api.deepseek.com/v1')).toBe('openai-chat');
    expect(detectWireFromBaseUrl('http://localhost:11434/v1')).toBe('openai-chat');
  });
});

describe('hydrateConfig / toPersistedV4', () => {
  it('round-trips cleanly — derived fields mirror v4 state', () => {
    const hydrated = hydrateConfig({
      version: 4,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: { volcano: { ...V4_ENTRY, baseUrl: 'http://localhost:4000' } },
    });
    expect(hydrated.provider).toBe('volcano');
    expect(hydrated.modelPrimary).toBe('kimi-k2.8-preview');
    expect(hydrated.baseUrls['volcano']?.baseUrl).toBe('http://localhost:4000');
    const persisted = toPersistedV4(hydrated);
    expect(persisted).not.toHaveProperty('provider');
    expect(persisted).not.toHaveProperty('baseUrls');
    expect(persisted.version).toBe(4);
  });

  it('preserves image generation settings when stripping derived fields', () => {
    const hydrated = hydrateConfig({
      version: 4,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: {},
      providers: { volcano: V4_ENTRY },
      imageGeneration: {
        schemaVersion: 1,
        enabled: true,
        provider: 'openai',
        credentialMode: 'inherit',
        model: 'gpt-image-2',
        quality: 'high',
        size: '1536x1024',
        outputFormat: 'png',
      },
    });
    expect(toPersistedV4(hydrated).imageGeneration?.model).toBe('gpt-image-2');
  });
});

describe('provider capability helpers', () => {
  it('lets explicit capability overrides win over defaults', () => {
    const caps = resolveProviderCapabilities('volcano', {
      wire: 'openai-chat',
      capabilities: { supportsKeyless: true },
    });
    expect(caps.supportsKeyless).toBe(true);
  });

  it('defaults to key-required and wire-derived reasoning', () => {
    const caps = resolveProviderCapabilities('volcano', { wire: 'openai-chat' });
    expect(caps.supportsKeyless).toBe(false);
    expect(caps.supportsReasoning).toBe(false);
    const anthropicCaps = resolveProviderCapabilities('volcano', { wire: 'anthropic' });
    expect(anthropicCaps.supportsReasoning).toBe(true);
  });
});

describe('migrateV3ToV4 defensive paths', () => {
  it('drops custom entries still carrying the removed codex wire', () => {
    const v4 = migrateV3ToV4({
      version: 3,
      activeProvider: 'volcano',
      activeModel: 'kimi-k2.8-preview',
      secrets: { 'codex-ish': { ciphertext: 'c' } },
      providers: {
        'codex-ish': {
          id: 'codex-ish',
          name: 'Custom codex wire',
          builtin: false,
          wire: 'openai-codex-responses',
          baseUrl: 'https://gw.example.com',
          defaultModel: 'gpt-5.4',
        },
        volcano: {
          id: 'volcano',
          name: '火山',
          builtin: false,
          wire: 'anthropic',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          defaultModel: 'kimi-k2.8-preview',
        },
      },
    });
    expect(Object.keys(v4.providers)).toEqual(['volcano']);
    expect(Object.keys(v4.secrets)).toEqual([]);
  });

  it('skips entries with no derivable model id instead of failing the migration', () => {
    const v4 = migrateV3ToV4({
      version: 3,
      activeProvider: 'broken',
      activeModel: 'm',
      secrets: { broken: { ciphertext: 'b' } },
      providers: {
        broken: {
          id: 'broken',
          name: 'Broken',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://broken.example.com/v1',
        },
        ok: {
          id: 'ok',
          name: 'OK',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'https://ok.example.com/v1',
          defaultModel: 'm1',
        },
      },
    });
    expect(Object.keys(v4.providers)).toEqual(['ok']);
    expect(v4.activeProvider).toBe('ok');
    expect(v4.activeModel).toBe('m1');
  });
});
