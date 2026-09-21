import { CompletionLengthError, type GenerateResult } from '@open-codesign/providers';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock electron-runtime so importing connection-ipc doesn't require('electron').
vi.mock('./electron-runtime', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('./tls-override', () => ({
  withTlsBypass: vi.fn(async (_enabled: boolean, fn: () => Promise<unknown>) => fn()),
}));

const completeMock = vi.hoisted(() => vi.fn());

vi.mock('@open-codesign/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-codesign/providers')>();
  return {
    ...actual,
    complete: (...args: unknown[]) => completeMock(...args),
  };
});

const cachedConfigMock = vi.hoisted(() => vi.fn<() => unknown>(() => null));

vi.mock('./onboarding-ipc', () => ({
  getApiKeyForProvider: vi.fn(),
  getCachedConfig: () => cachedConfigMock(),
  hasApiKeyForProvider: vi.fn(() => false),
}));

vi.mock('./provider-settings', () => ({
  isKeylessProviderAllowed: (
    _provider: string,
    entry?: { capabilities?: { supportsKeyless?: boolean } } | null,
  ) => entry?.capabilities?.supportsKeyless === true,
}));

import {
  classifyHttpError,
  classifyNetworkTarget,
  handleConfigV1TestEndpoint,
  handleConnectionV1TestProvider,
  type TestEndpointResponse,
} from './connection-ipc';

afterEach(() => {
  completeMock.mockReset();
  cachedConfigMock.mockReset();
  cachedConfigMock.mockReturnValue(null);
});

describe('classifyNetworkTarget', () => {
  it('classifies public, loopback and private targets', () => {
    expect(classifyNetworkTarget('https://provider.example/v1')).toBe('public');
    expect(classifyNetworkTarget('http://localhost:8317')).toBe('loopback');
    expect(classifyNetworkTarget('http://127.0.0.1:8317')).toBe('loopback');
    expect(classifyNetworkTarget('http://[::1]:8317')).toBe('loopback');
    expect(classifyNetworkTarget('http://10.0.0.5:8080')).toBe('private');
    expect(classifyNetworkTarget('http://172.16.0.9/v1')).toBe('private');
    expect(classifyNetworkTarget('http://192.168.1.4:9000')).toBe('private');
    expect(classifyNetworkTarget('http://169.254.169.254/latest/meta-data')).toBe('metadata');
    expect(classifyNetworkTarget('http://[fd12::1]/v1')).toBe('private');
    expect(classifyNetworkTarget('not a url')).toBe('public');
  });
});

describe('classifyHttpError', () => {
  it('maps auth statuses to the 401 code', () => {
    expect(classifyHttpError(401).code).toBe('401');
    expect(classifyHttpError(403).code).toBe('401');
  });
  it('maps 404 without a misleading /v1 hint', () => {
    const { code, hint } = classifyHttpError(404);
    expect(code).toBe('404');
    expect(hint).not.toContain('/v1');
  });
  it('maps everything else to NETWORK', () => {
    expect(classifyHttpError(500).code).toBe('NETWORK');
  });
});

describe('config:v1:test-endpoint (live message probe)', () => {
  const basePayload = {
    wire: 'anthropic' as const,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
    model: 'kimi-k2.8-preview',
    apiKey: 'ark-test-key',
  };

  it('rejects malformed payloads with bad-input', async () => {
    const res = await handleConfigV1TestEndpoint({ wire: 'bogus' });
    expect(res).toMatchObject({ ok: false, error: 'bad-input' });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('requires a model id', async () => {
    const res = await handleConfigV1TestEndpoint({ ...basePayload, model: '  ' });
    expect(res).toMatchObject({ ok: false, error: 'bad-input' });
  });

  it('rejects empty api keys unless keyless is set', async () => {
    const res = await handleConfigV1TestEndpoint({ ...basePayload, apiKey: '' });
    expect(res).toMatchObject({ ok: false, error: 'bad-input' });
  });

  it('blocks metadata service endpoints', async () => {
    const res = await handleConfigV1TestEndpoint({
      ...basePayload,
      baseUrl: 'http://169.254.169.254/latest/meta-data',
    });
    expect(res).toMatchObject({ ok: false, error: 'blocked-network-target' });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation for private network targets', async () => {
    const res = await handleConfigV1TestEndpoint({
      ...basePayload,
      baseUrl: 'http://10.0.0.5:8080/v1',
    });
    expect(res).toMatchObject({ ok: false, error: 'private-network-confirmation-required' });
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('sends one tiny real generation and reports the reply', async () => {
    const result: GenerateResult = {
      content: '  pong  ',
      inputTokens: 10,
      outputTokens: 1,
      costUsd: 0,
    };
    completeMock.mockResolvedValue(result);
    const res: TestEndpointResponse = await handleConfigV1TestEndpoint(basePayload);
    expect(res).toEqual({ ok: true, reply: 'pong' });
    const [model, messages, opts] = completeMock.mock.calls[0] as unknown[];
    expect(model).toEqual({ provider: 'custom-probe', modelId: 'kimi-k2.8-preview' });
    expect(messages).toEqual([{ role: 'user', content: 'Reply with exactly: pong' }]);
    expect(opts).toMatchObject({
      apiKey: 'ark-test-key',
      maxTokens: 256,
      reasoning: 'off',
      wire: 'anthropic',
      baseUrl: basePayload.baseUrl,
    });
  });

  it('treats a CompletionLengthError as connectivity verified', async () => {
    completeMock.mockRejectedValue(
      new CompletionLengthError({
        inputTokens: 10,
        outputTokens: 256,
        costUsd: 0,
      }),
    );
    const res = await handleConfigV1TestEndpoint(basePayload);
    expect(res).toEqual({ ok: true });
  });

  it('surfaces auth failures with the 401 category', async () => {
    completeMock.mockRejectedValue(
      new CodesignError('HTTP 401: invalid key', ERROR_CODES.PROVIDER_ERROR),
    );
    const res = await handleConfigV1TestEndpoint(basePayload);
    expect(res).toMatchObject({ ok: false, error: '401', message: 'HTTP 401' });
  });

  it('surfaces network failures', async () => {
    completeMock.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));
    const res = await handleConfigV1TestEndpoint(basePayload);
    expect(res).toMatchObject({ ok: false });
  });

  it('allows keyless probes against private networks with explicit confirmation', async () => {
    const result: GenerateResult = {
      content: 'pong',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    };
    completeMock.mockResolvedValue(result);
    const res = await handleConfigV1TestEndpoint({
      ...basePayload,
      baseUrl: 'http://10.0.0.5:8080/v1',
      apiKey: '',
      keyless: true,
      allowPrivateNetwork: true,
    });
    expect(res).toEqual({ ok: true, reply: 'pong' });
  });
});

describe('connection:v1:test-provider', () => {
  it('probes keyless providers with allowKeyless instead of failing on the empty key', async () => {
    cachedConfigMock.mockReturnValue({
      activeProvider: 'local-llm',
      activeModel: 'llama3.2',
      secrets: {},
      providers: {
        'local-llm': {
          id: 'local-llm',
          name: 'Local LLM',
          wire: 'openai-chat',
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: ['llama3.2'],
          capabilities: { supportsKeyless: true },
        },
      },
    });
    const result: GenerateResult = {
      content: 'pong',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
    };
    completeMock.mockResolvedValue(result);

    const res = await handleConnectionV1TestProvider('local-llm');
    expect(res).toEqual({ ok: true, reply: 'pong' });
    const opts = completeMock.mock.calls[0]?.[2] as { apiKey: string; allowKeyless?: boolean };
    expect(opts.apiKey).toBe('');
    expect(opts.allowKeyless).toBe(true);
  });

  it('rejects providers with no configured models', async () => {
    cachedConfigMock.mockReturnValue({
      activeProvider: 'empty',
      activeModel: 'm',
      secrets: {},
      providers: {
        empty: {
          id: 'empty',
          name: 'Empty',
          wire: 'openai-chat',
          baseUrl: 'https://x.example/v1',
          models: [],
        },
      },
    });
    const res = await handleConnectionV1TestProvider('empty');
    expect(res).toMatchObject({ ok: false, code: 'IPC_BAD_INPUT' });
    expect(completeMock).not.toHaveBeenCalled();
  });
});
