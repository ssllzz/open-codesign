import {
  CodesignError,
  ERROR_CODES,
  type ReasoningLevel,
  ReasoningLevelSchema,
  type WireApi,
  WireApiSchema,
} from '@open-codesign/shared';

export interface AddCustomProviderInput {
  id: string;
  name: string;
  wire: WireApi;
  baseUrl: string;
  apiKey: string;
  /** Persisted as `capabilities.supportsKeyless`. */
  keyless?: boolean;
  /** Manually entered model IDs (≥1). */
  models: string[];
  httpHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  envKey?: string;
  /** Per-provider TLS verification opt-out (#229). */
  tlsRejectUnauthorized?: boolean;
  setAsActive: boolean;
}

export interface UpdateProviderInput {
  id: string;
  keyless?: boolean;
  name?: string;
  baseUrl?: string;
  models?: string[];
  httpHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  wire?: WireApi;
  reasoningLevel?: ReasoningLevel | null;
  /** When present AND non-empty, re-encrypt and replace the stored secret.
   *  Empty string means "clear stored secret" for keyless providers.
   *  `undefined` means "leave alone". */
  apiKey?: string;
  /** Tri-state: `true`/`false` writes the field; `null` clears it back to
   *  the default (strict TLS); `undefined` leaves the existing value alone. */
  tlsRejectUnauthorized?: boolean | null;
}

const ADD_PROVIDER_FIELDS = [
  'id',
  'name',
  'wire',
  'baseUrl',
  'apiKey',
  'keyless',
  'models',
  'httpHeaders',
  'queryParams',
  'envKey',
  'tlsRejectUnauthorized',
  'setAsActive',
] as const;
const UPDATE_PROVIDER_FIELDS = [
  'id',
  'name',
  'baseUrl',
  'models',
  'httpHeaders',
  'queryParams',
  'wire',
  'reasoningLevel',
  'apiKey',
  'keyless',
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

function stringMapFromOptional(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodesignError(`${field} must be an object`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new CodesignError(`${field}.${k} must be a string`, ERROR_CODES.IPC_BAD_INPUT);
    }
    map[k] = v;
  }
  return map;
}

function validUrl(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CodesignError(`${field} must be a non-empty string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new CodesignError(
        `${field} must use http(s), got "${parsed.protocol}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    return trimmed;
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(`${field} "${value}" is not a valid URL`, ERROR_CODES.IPC_BAD_INPUT);
  }
}

function validRequiredUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CodesignError(`${field} must be a non-empty string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  return validUrl(value, field);
}

function parseModelsList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CodesignError(
      `${field} must be a non-empty array of model IDs`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new CodesignError(
        `${field} entries must be non-empty strings`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    const trimmed = item.trim();
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  if (out.length === 0) {
    throw new CodesignError(
      `${field} must contain at least one model ID`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  return out;
}

export function parseAddProviderPayload(raw: unknown): AddCustomProviderInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('config:v1:add-provider expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, ADD_PROVIDER_FIELDS, 'config:v1:add-provider');
  const id = r['id'];
  const name = r['name'];
  const wire = r['wire'];
  const baseUrl = r['baseUrl'];
  const apiKey = r['apiKey'];
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CodesignError('id must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new CodesignError('name must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const parsedWire = WireApiSchema.safeParse(wire);
  if (!parsedWire.success) {
    throw new CodesignError(`Unsupported wire: ${String(wire)}`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const parsedBaseUrl = validRequiredUrl(baseUrl, 'baseUrl');
  const keyless = r['keyless'];
  if (keyless !== undefined && typeof keyless !== 'boolean') {
    throw new CodesignError('keyless must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (typeof apiKey !== 'string') {
    throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
  }
  if (apiKey.trim().length === 0 && keyless !== true) {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const models = parseModelsList(r['models'], 'models');
  const setAsActive = r['setAsActive'];
  if (typeof setAsActive !== 'boolean') {
    throw new CodesignError('setAsActive must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: AddCustomProviderInput = {
    id: id.trim(),
    name: name.trim(),
    wire: parsedWire.data,
    baseUrl: parsedBaseUrl,
    apiKey: apiKey.trim(),
    models,
    setAsActive,
    ...(keyless !== undefined ? { keyless } : {}),
  };
  const headers = stringMapFromOptional(r['httpHeaders'], 'httpHeaders');
  if (headers !== undefined && Object.keys(headers).length > 0) out.httpHeaders = headers;
  const qp = stringMapFromOptional(r['queryParams'], 'queryParams');
  if (qp !== undefined && Object.keys(qp).length > 0) out.queryParams = qp;
  if (r['envKey'] !== undefined) {
    if (typeof r['envKey'] !== 'string' || r['envKey'].trim().length === 0) {
      throw new CodesignError('envKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.envKey = r['envKey'].trim();
  }
  if (r['tlsRejectUnauthorized'] !== undefined) {
    if (typeof r['tlsRejectUnauthorized'] !== 'boolean') {
      throw new CodesignError('tlsRejectUnauthorized must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.tlsRejectUnauthorized = r['tlsRejectUnauthorized'];
  }
  return out;
}

export function parseUpdateProviderPayload(raw: unknown): UpdateProviderInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      'config:v1:update-provider expects an object',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const r = raw as Record<string, unknown>;
  assertKnownFields(r, UPDATE_PROVIDER_FIELDS, 'config:v1:update-provider');
  const id = r['id'];
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CodesignError('id must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: UpdateProviderInput = { id: id.trim() };
  if (r['keyless'] !== undefined) {
    if (typeof r['keyless'] !== 'boolean') {
      throw new CodesignError('keyless must be a boolean', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.keyless = r['keyless'];
  }
  if (r['name'] !== undefined) {
    if (typeof r['name'] !== 'string' || r['name'].trim().length === 0) {
      throw new CodesignError('name must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.name = r['name'].trim();
  }
  if (r['baseUrl'] !== undefined) {
    out.baseUrl = validRequiredUrl(r['baseUrl'], 'baseUrl');
  }
  if (r['models'] !== undefined) {
    out.models = parseModelsList(r['models'], 'models');
  }
  const headers = stringMapFromOptional(r['httpHeaders'], 'httpHeaders');
  if (headers !== undefined) out.httpHeaders = headers;
  const queryParams = stringMapFromOptional(r['queryParams'], 'queryParams');
  if (queryParams !== undefined) out.queryParams = queryParams;
  if (r['wire'] !== undefined) {
    const parsedWire = WireApiSchema.safeParse(r['wire']);
    if (!parsedWire.success) {
      throw new CodesignError(`Unsupported wire: ${String(r['wire'])}`, ERROR_CODES.IPC_BAD_INPUT);
    }
    out.wire = parsedWire.data;
  }
  if (r['reasoningLevel'] === null) {
    // Explicit null clears the override so the core default kicks in.
    out.reasoningLevel = null;
  } else if (r['reasoningLevel'] !== undefined) {
    if (typeof r['reasoningLevel'] !== 'string') {
      throw new CodesignError('reasoningLevel must be a string', ERROR_CODES.IPC_BAD_INPUT);
    }
    const parsed = ReasoningLevelSchema.safeParse(r['reasoningLevel']);
    if (!parsed.success) {
      throw new CodesignError(
        `Unsupported reasoningLevel: ${String(r['reasoningLevel'])}`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    out.reasoningLevel = parsed.data;
  }
  if (r['apiKey'] !== undefined) {
    if (typeof r['apiKey'] !== 'string') {
      throw new CodesignError('apiKey must be a string', ERROR_CODES.IPC_BAD_INPUT);
    }
    out.apiKey = r['apiKey'];
  }
  if (r['tlsRejectUnauthorized'] === null) {
    out.tlsRejectUnauthorized = null;
  } else if (r['tlsRejectUnauthorized'] !== undefined) {
    if (typeof r['tlsRejectUnauthorized'] !== 'boolean') {
      throw new CodesignError(
        'tlsRejectUnauthorized must be a boolean or null',
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    out.tlsRejectUnauthorized = r['tlsRejectUnauthorized'];
  }
  return out;
}
