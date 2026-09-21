import {
  CodesignError,
  type Config,
  ERROR_CODES,
  hydrateConfig,
  type OnboardingState,
  type ProviderCapabilities,
  type ProviderEntry,
} from '@open-codesign/shared';
import { writeConfig } from '../config';
import { buildSecretRef, decryptSecret } from '../keychain';
import {
  assertProviderHasStoredSecret,
  computeDeleteProviderResult,
  isKeylessProviderAllowed,
  type ProviderRow,
  toProviderRows,
} from '../provider-settings';
import { getCachedConfig, setCachedConfig, toState } from './config-cache';
import type { AddCustomProviderInput, UpdateProviderInput } from './provider-parsers';

export function runListProviders(): ProviderRow[] {
  // Secret migration happens once at boot (see `loadConfigOnBoot` →
  // `migrateSecrets`). By the time Settings is opened, every row has a
  // persisted plaintext + mask and `toProviderRows` never touches any
  // decrypt path for render. `decryptSecret` is only passed in as a
  // late-stage normalization for exotic rows that somehow slipped through.
  return toProviderRows(getCachedConfig(), decryptSecret);
}

export async function runDeleteProvider(raw: unknown): Promise<ProviderRow[]> {
  if (typeof raw !== 'string') {
    throw new CodesignError('delete-provider expects a provider string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const cfg = getCachedConfig();
  if (cfg === null) return [];
  const nextSecrets = { ...cfg.secrets };
  delete nextSecrets[raw];
  const nextProviders: Record<string, ProviderEntry> = { ...cfg.providers };
  delete nextProviders[raw];

  const { nextActive, modelPrimary } = computeDeleteProviderResult(cfg, raw);

  if (nextActive === null) {
    // All providers gone. Reset BOTH activeProvider and activeModel to ''
    // so the config doesn't carry a dangling reference to the just-deleted
    // provider id.
    const emptyNext: Config = hydrateConfig({
      version: 4,
      activeProvider: '',
      activeModel: '',
      secrets: {},
      providers: nextProviders,
      ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
      ...(cfg.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
    });
    await writeConfig(emptyNext);
    setCachedConfig(emptyNext);
    return toProviderRows(emptyNext, decryptSecret);
  }

  const next: Config = hydrateConfig({
    version: 4,
    activeProvider: nextActive,
    activeModel: modelPrimary,
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    ...(cfg.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toProviderRows(next, decryptSecret);
}

export async function runSetActiveProvider(raw: unknown): Promise<OnboardingState> {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('set-active-provider expects an object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (key !== 'provider' && key !== 'modelPrimary') {
      throw new CodesignError(
        `set-active-provider contains unsupported field "${key}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
  }
  const provider = r['provider'];
  const modelPrimary = r['modelPrimary'];
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    throw new CodesignError('provider must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const providerId = provider.trim();
  if (typeof modelPrimary !== 'string' || modelPrimary.trim().length === 0) {
    throw new CodesignError('modelPrimary must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const activeModel = modelPrimary.trim();
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', ERROR_CODES.CONFIG_MISSING);
  }
  assertProviderHasStoredSecret(cfg, providerId);
  const next: Config = hydrateConfig({
    version: 4,
    activeProvider: providerId,
    activeModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    ...(cfg.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}

function capabilitiesWithKeyless(
  existing: ProviderCapabilities | undefined,
  keyless: boolean,
): ProviderCapabilities | undefined {
  if (!keyless) {
    if (existing?.supportsKeyless === undefined) return existing;
    const { supportsKeyless: _k, ...rest } = existing;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }
  return { ...(existing ?? {}), supportsKeyless: true };
}

export async function runAddCustomProvider(
  input: AddCustomProviderInput,
): Promise<OnboardingState> {
  const cachedConfig = getCachedConfig();
  const entry: ProviderEntry = {
    id: input.id,
    name: input.name,
    wire: input.wire,
    baseUrl: input.baseUrl,
    models: input.models,
    ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
    ...(input.queryParams !== undefined ? { queryParams: input.queryParams } : {}),
    ...(input.envKey !== undefined ? { envKey: input.envKey } : {}),
    ...(input.tlsRejectUnauthorized === true ? { tlsRejectUnauthorized: true } : {}),
    ...(input.keyless === true ? { capabilities: { supportsKeyless: true } } : {}),
  };
  const nextProviders = { ...(cachedConfig?.providers ?? {}), [entry.id]: entry };
  const nextSecrets = { ...(cachedConfig?.secrets ?? {}) };
  if (input.apiKey.trim().length > 0) {
    nextSecrets[entry.id] = buildSecretRef(input.apiKey.trim());
  } else if (input.keyless === true) {
    delete nextSecrets[entry.id];
  } else {
    throw new CodesignError('apiKey must be a non-empty string', ERROR_CODES.IPC_BAD_INPUT);
  }
  const shouldActivate = input.setAsActive || cachedConfig === null;
  const firstModel = input.models[0] ?? '';
  const next = hydrateConfig({
    version: 4,
    activeProvider: shouldActivate ? entry.id : (cachedConfig?.activeProvider ?? entry.id),
    activeModel: shouldActivate ? firstModel : (cachedConfig?.activeModel ?? firstModel),
    secrets: nextSecrets,
    providers: nextProviders,
    ...(cachedConfig?.designSystem !== undefined
      ? { designSystem: cachedConfig.designSystem }
      : {}),
    ...(cachedConfig?.imageGeneration !== undefined
      ? { imageGeneration: cachedConfig.imageGeneration }
      : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}

export async function runUpdateProvider(input: UpdateProviderInput): Promise<OnboardingState> {
  const cfg = getCachedConfig();
  if (cfg === null) {
    throw new CodesignError('No configuration found', ERROR_CODES.CONFIG_MISSING);
  }
  const existing = cfg.providers[input.id];
  if (existing === undefined) {
    throw new CodesignError(`Provider "${input.id}" not found`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const updated: ProviderEntry = {
    ...existing,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.models !== undefined ? { models: input.models } : {}),
    ...(input.httpHeaders !== undefined ? { httpHeaders: input.httpHeaders } : {}),
    ...(input.queryParams !== undefined ? { queryParams: input.queryParams } : {}),
    ...(input.wire !== undefined ? { wire: input.wire } : {}),
  };
  if (input.keyless !== undefined) {
    updated.capabilities = capabilitiesWithKeyless(updated.capabilities, input.keyless);
  }
  // reasoningLevel has a tri-state semantic: undefined means "untouched",
  // null means "explicitly clear the override so core picks the default",
  // a string level means "set it". Handle separately from the spread above
  // because the `...undefined ? {} : {...}` pattern can't express "delete".
  if (input.reasoningLevel === null) {
    updated.reasoningLevel = undefined;
  } else if (input.reasoningLevel !== undefined) {
    updated.reasoningLevel = input.reasoningLevel;
  }
  // tlsRejectUnauthorized tri-state: null clears the field (back to strict
  // TLS), true persists the opt-out, false also clears (omit-when-default).
  if (input.tlsRejectUnauthorized === null || input.tlsRejectUnauthorized === false) {
    updated.tlsRejectUnauthorized = undefined;
  } else if (input.tlsRejectUnauthorized === true) {
    updated.tlsRejectUnauthorized = true;
  }
  // Secret rotation: only touch secrets when the caller explicitly supplied
  // an apiKey field. Empty string clears the secret (keyless providers);
  // a non-empty value re-encrypts under the current safeStorage session key.
  let nextSecrets = cfg.secrets;
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    if (trimmed.length === 0) {
      if (!isKeylessProviderAllowed(input.id, updated)) {
        throw new CodesignError(
          `Cannot clear API key for provider "${input.id}" unless it explicitly supports keyless mode.`,
          ERROR_CODES.PROVIDER_KEY_MISSING,
        );
      }
      const { [input.id]: _removed, ...rest } = cfg.secrets;
      nextSecrets = rest;
    } else {
      nextSecrets = { ...cfg.secrets, [input.id]: buildSecretRef(trimmed) };
    }
  }
  if (input.keyless === false && nextSecrets[input.id] === undefined) {
    throw new CodesignError(
      `No API key stored for provider "${input.id}". Enter an API key to require authentication.`,
      ERROR_CODES.PROVIDER_KEY_MISSING,
    );
  }
  const next = hydrateConfig({
    version: 4,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: nextSecrets,
    providers: { ...cfg.providers, [input.id]: updated },
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    ...(cfg.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
  });
  await writeConfig(next);
  setCachedConfig(next);
  return toState(next);
}
