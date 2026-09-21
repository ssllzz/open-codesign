import { isIP } from 'node:net';
import { CompletionLengthError, complete } from '@open-codesign/providers';
import {
  CodesignError,
  type DiagnosticCategory,
  ERROR_CODES,
  type ProviderEntry,
  type WireApi,
} from '@open-codesign/shared';
import { ipcMain } from './electron-runtime';
import { getApiKeyForProvider, getCachedConfig, hasApiKeyForProvider } from './onboarding-ipc';
import { isKeylessProviderAllowed } from './provider-settings';
import { withTlsBypass } from './tls-override';

// ---------------------------------------------------------------------------
// Payload schemas (plain validation, no zod in main to keep bundle lean)
// ---------------------------------------------------------------------------

const TEST_ENDPOINT_FIELDS = [
  'wire',
  'baseUrl',
  'apiKey',
  'model',
  'keyless',
  'httpHeaders',
  'allowPrivateNetwork',
  'tlsRejectUnauthorized',
] as const;

function assertKnownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new CodesignError(
        `${context} contains unsupported field "${key}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
  }
}

function parseHttpBaseUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CodesignError(`${field} must be a non-empty string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CodesignError(`${field} "${trimmed}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CodesignError(
      `${field} must use http(s), got "${parsed.protocol}"`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  return trimmed;
}

export type NetworkTargetClass = 'public' | 'loopback' | 'private' | 'link-local' | 'metadata';

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

function inIpv4Range(ip: string, base: string, bits: number): boolean {
  const value = ipv4ToNumber(ip);
  const baseValue = ipv4ToNumber(base);
  if (value === null || baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

export function classifyNetworkTarget(rawBaseUrl: string): NetworkTargetClass {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    return 'public';
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === '169.254.169.254' ||
    host === 'fd00:ec2::254'
  ) {
    return 'metadata';
  }
  if (host === 'localhost') return 'loopback';
  const family = isIP(host);
  if (family === 4) {
    if (inIpv4Range(host, '127.0.0.0', 8)) return 'loopback';
    if (inIpv4Range(host, '10.0.0.0', 8)) return 'private';
    if (inIpv4Range(host, '172.16.0.0', 12)) return 'private';
    if (inIpv4Range(host, '192.168.0.0', 16)) return 'private';
    if (inIpv4Range(host, '169.254.0.0', 16)) return 'link-local';
    return 'public';
  }
  if (family === 6) {
    if (host === '::1') return 'loopback';
    if (host.startsWith('fe80:')) return 'link-local';
    if (host.startsWith('fc') || host.startsWith('fd')) return 'private';
  }
  return 'public';
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export function classifyHttpError(status: number): {
  code: '401' | '404' | 'NETWORK';
  hint: string;
} {
  if (status === 401 || status === 403) {
    return { code: '401', hint: 'API key 错误或权限不足' };
  }
  if (status === 404) {
    return { code: '404', hint: 'baseUrl 路径或模型 ID 错误（对照服务商文档检查）' };
  }
  return { code: 'NETWORK', hint: `服务器返回 HTTP ${status}` };
}

function connectionCategoryForStatus(status: number): DiagnosticCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'endpoint-not-found';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'upstream-server-error';
  return 'unknown';
}

function classifyNetworkError(err: unknown): { code: 'ECONNREFUSED' | 'NETWORK'; hint: string } {
  const message = err instanceof Error ? err.message : String(err);
  // AbortSignal.timeout() aborts with a DOMException named 'TimeoutError',
  // while manual abort() uses 'AbortError'.
  const isTimeout =
    err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
  if (isTimeout) {
    return {
      code: 'NETWORK',
      hint: `请求超时，检查 baseUrl 与网络可达性`,
    };
  }
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return {
      code: 'ECONNREFUSED',
      hint: '无法连接到 baseUrl，检查域名 / 端口 / 网络',
    };
  }
  return {
    code: 'NETWORK',
    hint: `网络错误：${message}`,
  };
}

function extractHttpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidates = [
    (err as { status?: unknown }).status,
    (err as { statusCode?: unknown }).statusCode,
    (err as { upstream_status?: unknown }).upstream_status,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 100 && c < 600) return c;
  }
  if (err instanceof Error) {
    const m = /\b([1-5]\d\d)\b/.exec(err.message);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n >= 400 && n < 600) return n;
    }
  }
  // Heuristic: the regex takes the FIRST 3-digit number in the message, so an
  // error like "after 450 ms ... HTTP 401" can misreport. Structured status
  // fields above always win; this branch is a last resort for opaque errors.
  return undefined;
}

// Real generation takes longer than a /models GET — allow enough room for
// reasoning-style models to emit a few thinking tokens before "pong".
const CONNECTION_TEST_TIMEOUT_MS = 30_000;
const CONNECTION_TEST_MAX_TOKENS = 256;
const CONNECTION_TEST_PROMPT = 'Reply with exactly: pong';

export interface ConnectionTestResult {
  ok: true;
  /** Excerpt of the model's reply — proof the round-trip worked. */
  reply?: string;
}

export interface ConnectionTestError {
  ok: false;
  code: 'IPC_BAD_INPUT' | '401' | '404' | 'ECONNREFUSED' | 'NETWORK' | 'PARSE';
  message: string;
  hint: string;
  reasonCategory?: DiagnosticCategory;
}

export type ConnectionTestResponse = ConnectionTestResult | ConnectionTestError;

// ---------------------------------------------------------------------------
// Live message probe — one tiny real generation verifies key + baseUrl + model
// in a single round-trip. Works for gateways that expose no /models listing
// (e.g. Volcengine Ark Agent Plan).
// ---------------------------------------------------------------------------

interface ProbeInput {
  provider: string;
  model: string;
  wire: WireApi;
  baseUrl?: string | undefined;
  apiKey: string;
  allowKeyless?: boolean | undefined;
  httpHeaders?: Record<string, string> | undefined;
  tlsRejectUnauthorized?: boolean | undefined;
}

async function probeWithLiveMessage(input: ProbeInput): Promise<ConnectionTestResponse> {
  const bypass = input.tlsRejectUnauthorized === true;
  return withTlsBypass(bypass, async () => {
    try {
      const result = await complete(
        { provider: input.provider, modelId: input.model },
        [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
        {
          apiKey: input.apiKey,
          maxTokens: CONNECTION_TEST_MAX_TOKENS,
          reasoning: 'off',
          ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
          ...(input.wire !== undefined ? { wire: input.wire } : {}),
          ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
          ...(input.allowKeyless === true ? { allowKeyless: true } : {}),
          signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
        },
      );
      const reply = result.content.trim().slice(0, 120);
      return { ok: true, ...(reply.length > 0 ? { reply } : {}) };
    } catch (err) {
      // A length stop means the server accepted auth, routing and model and
      // produced tokens — the connection itself is verified. Surface as ok.
      if (err instanceof CompletionLengthError) {
        return { ok: true };
      }
      const status = extractHttpStatus(err);
      if (status !== undefined) {
        const { code, hint } = classifyHttpError(status);
        return {
          ok: false,
          code,
          message: `HTTP ${status}`,
          hint,
          reasonCategory: connectionCategoryForStatus(status),
        };
      }
      const { code, hint } = classifyNetworkError(err);
      return {
        ok: false,
        code,
        message: err instanceof Error ? err.message : 'Connection test failed',
        hint,
        reasonCategory: code === 'ECONNREFUSED' ? 'network-unreachable' : 'unknown',
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Credential resolution for stored providers
// ---------------------------------------------------------------------------

export interface ActiveProviderCredentials {
  provider: string;
  model: string;
  wire: WireApi;
  apiKey: string;
  baseUrl: string;
  allowKeyless?: boolean;
  httpHeaders?: Record<string, string>;
  tlsRejectUnauthorized?: boolean;
}

function resolveCredentialsForProvider(
  providerId: string,
): ActiveProviderCredentials | ConnectionTestError {
  const cfg = getCachedConfig();
  if (cfg === null || providerId.length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'No active provider configured',
      hint: 'Add a provider in Settings first',
    };
  }
  const entry: ProviderEntry | undefined = cfg.providers[providerId];
  if (entry === undefined) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: `Provider "${providerId}" not found in config`,
      hint: 'Re-add the provider from Settings',
    };
  }
  let apiKey = '';
  let allowKeyless = false;
  if (isKeylessProviderAllowed(providerId, entry) && !hasApiKeyForProvider(providerId)) {
    apiKey = '';
    allowKeyless = true;
  } else {
    try {
      apiKey = getApiKeyForProvider(providerId);
    } catch (err) {
      return {
        ok: false,
        code: 'IPC_BAD_INPUT',
        message:
          err instanceof Error ? err.message : `No API key stored for provider "${providerId}"`,
        hint: 'Open Settings and add an API key for this provider',
      };
    }
  }
  return {
    provider: providerId,
    model: entry.models[0] ?? '',
    wire: entry.wire,
    apiKey,
    baseUrl: entry.baseUrl,
    allowKeyless,
    ...(entry.httpHeaders !== undefined ? { httpHeaders: entry.httpHeaders } : {}),
    ...(entry.tlsRejectUnauthorized !== undefined
      ? { tlsRejectUnauthorized: entry.tlsRejectUnauthorized }
      : {}),
  };
}

export function registerConnectionIpc(): void {
  // Tests a specific provider by id — used by the per-row "Test connection"
  // button in Settings. Sends one tiny real generation with the provider's
  // first configured model.
  ipcMain.handle('connection:v1:test-provider', (_e, raw: unknown) =>
    handleConnectionV1TestProvider(raw),
  );

  // ── Wire-agnostic test endpoint (custom provider Add form) ───────────────
  ipcMain.handle('config:v1:test-endpoint', (_e, raw: unknown) => handleConfigV1TestEndpoint(raw));
}

export async function handleConnectionV1TestProvider(
  raw: unknown,
): Promise<ConnectionTestResponse> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: 'test-provider expects a provider id string',
      hint: 'Internal error — missing provider id',
    };
  }
  const creds = resolveCredentialsForProvider(raw);
  if (!('provider' in creds)) return creds;
  if (creds.model.length === 0) {
    return {
      ok: false,
      code: 'IPC_BAD_INPUT',
      message: `Provider "${raw}" has no model IDs configured`,
      hint: 'Edit the provider and add at least one model ID',
    };
  }
  return probeWithLiveMessage({
    provider: creds.provider,
    model: creds.model,
    wire: creds.wire,
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    allowKeyless: creds.allowKeyless === true,
    ...(creds.httpHeaders !== undefined ? { httpHeaders: creds.httpHeaders } : {}),
    ...(creds.tlsRejectUnauthorized !== undefined
      ? { tlsRejectUnauthorized: creds.tlsRejectUnauthorized }
      : {}),
  });
}

interface TestEndpointPayload {
  wire: WireApi;
  baseUrl: string;
  apiKey: string;
  model: string;
  keyless?: boolean;
  httpHeaders?: Record<string, string>;
  allowPrivateNetwork?: boolean;
  tlsRejectUnauthorized?: boolean;
}

export type TestEndpointResponse =
  | { ok: true; reply?: string }
  | { ok: false; error: string; message: string };

function parseTestEndpointPayload(raw: unknown): TestEndpointPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('config:v1:test-endpoint expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, TEST_ENDPOINT_FIELDS, 'config:v1:test-endpoint');
  const wire = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  const model = r['model'];
  if (wire !== 'openai-chat' && wire !== 'openai-responses' && wire !== 'anthropic') {
    throw new CodesignError(`Unsupported wire: ${String(wire)}`, ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof apiKey !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new CodesignError('model must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const trimmedApiKey = apiKey.trim();
  const keyless = r['keyless'];
  if (keyless !== undefined && typeof keyless !== 'boolean') {
    throw new CodesignError('keyless must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (trimmedApiKey.length === 0 && keyless !== true) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: TestEndpointPayload = {
    wire,
    baseUrl: parseHttpBaseUrl(baseUrl, 'baseUrl'),
    apiKey: trimmedApiKey,
    model: model.trim(),
    ...(keyless !== undefined ? { keyless } : {}),
  };
  if (r['allowPrivateNetwork'] !== undefined) {
    if (typeof r['allowPrivateNetwork'] !== 'boolean') {
      throw new CodesignError('allowPrivateNetwork must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.allowPrivateNetwork = r['allowPrivateNetwork'];
  }
  if (r['tlsRejectUnauthorized'] !== undefined) {
    if (typeof r['tlsRejectUnauthorized'] !== 'boolean') {
      throw new CodesignError('tlsRejectUnauthorized must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.tlsRejectUnauthorized = r['tlsRejectUnauthorized'];
  }
  const headers = parseTestEndpointHttpHeaders(r['httpHeaders']);
  if (headers !== undefined) out.httpHeaders = headers;
  return out;
}

function parseTestEndpointHttpHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodesignError('httpHeaders must be an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new CodesignError(`httpHeaders.${k} must be a string`, ERROR_CODES.IPC_BAD_INPUT);
    }
    map[k] = v;
  }
  return map;
}

export async function handleConfigV1TestEndpoint(raw: unknown): Promise<TestEndpointResponse> {
  let payload: TestEndpointPayload;
  try {
    payload = parseTestEndpointPayload(raw);
  } catch (err) {
    return {
      ok: false,
      error: 'bad-input',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const targetClass = classifyNetworkTarget(payload.baseUrl);
  if (targetClass === 'metadata') {
    return {
      ok: false,
      error: 'blocked-network-target',
      message: 'Metadata service endpoints cannot be used as model provider base URLs.',
    };
  }
  if (targetClass !== 'public' && payload.allowPrivateNetwork !== true) {
    return {
      ok: false,
      error: 'private-network-confirmation-required',
      message: 'Private or local network provider URLs require explicit confirmation.',
    };
  }

  const result = await probeWithLiveMessage({
    provider: 'custom-probe',
    model: payload.model,
    wire: payload.wire,
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    allowKeyless: payload.keyless === true,
    ...(payload.httpHeaders !== undefined ? { httpHeaders: payload.httpHeaders } : {}),
    ...(payload.tlsRejectUnauthorized !== undefined
      ? { tlsRejectUnauthorized: payload.tlsRejectUnauthorized }
      : {}),
  });
  if (result.ok) {
    return { ok: true, ...(result.reply !== undefined ? { reply: result.reply } : {}) };
  }
  return { ok: false, error: result.code.toLowerCase(), message: result.message };
}
