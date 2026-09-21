import {
  CodesignError,
  type Config,
  ERROR_CODES,
  type ModelRef,
  type ProviderEntry,
  type ReasoningLevel,
  resolveProviderCapabilities,
  type WireApi,
} from '@open-codesign/shared';
import { maskSecret } from './keychain';

export interface ProviderRow {
  provider: string;
  maskedKey: string;
  baseUrl: string | null;
  isActive: boolean;
  /** Human-readable display label (= the stored entry name). */
  label: string;
  /** Actual stored provider name — the value that round-trips through
   *  updateProvider. Same as `label` for all v4 providers. */
  name: string;
  wire: WireApi;
  /** Manually configured model IDs — the model switcher's source of truth. */
  models: string[];
  hasKey: boolean;
  /** True when the entry declares keyless support and no secret is stored. */
  keyless: boolean;
  reasoningLevel?: ReasoningLevel;
  /** Per-provider TLS verification opt-out (#229). */
  tlsRejectUnauthorized?: boolean;
  error?: 'decryption_failed' | string;
}

/**
 * @deprecated Use `maskSecret` from `./keychain`. Re-exported for tests that
 * still import the old name.
 */
export const maskKey = maskSecret;

export function assertProviderHasStoredSecret(cfg: Config, provider: string): void {
  if (cfg.secrets[provider] !== undefined) return;
  if (isKeylessProviderAllowed(provider, resolveEntryFor(cfg, provider))) return;
  throw new CodesignError(
    `No API key stored for provider "${provider}".`,
    ERROR_CODES.PROVIDER_KEY_MISSING,
  );
}

export function isKeylessProviderAllowed(provider: string, entry?: ProviderEntry | null): boolean {
  if (entry === undefined || entry === null) return false;
  return resolveProviderCapabilities(provider, entry).supportsKeyless === true;
}

function resolveEntryFor(cfg: Config, id: string): ProviderEntry | null {
  return cfg.providers[id] ?? null;
}

export function toProviderRows(
  cfg: Config | null,
  decrypt: (ciphertext: string) => string,
): ProviderRow[] {
  if (cfg === null) return [];

  const rows: ProviderRow[] = [];
  // Iterate the union of provider entries and stored secrets so that
  // providers added without an API key still surface as a row the user can
  // complete via "Edit". Otherwise they'd silently disappear.
  const allIds = new Set<string>([
    ...Object.keys(cfg.providers ?? {}),
    ...Object.keys(cfg.secrets ?? {}),
  ]);
  for (const provider of allIds) {
    const ref = cfg.secrets?.[provider];
    const entry = resolveEntryFor(cfg, provider);

    let maskedKey = '';
    let rowError: ProviderRow['error'];
    if (ref !== undefined) {
      // Prefer the persisted mask — avoids triggering a keychain password
      // prompt on unsigned macOS builds just to render the Settings row.
      if (ref.mask !== undefined && ref.mask.length > 0) {
        maskedKey = ref.mask;
      } else {
        try {
          const plain = decrypt(ref.ciphertext);
          maskedKey = maskSecret(plain);
        } catch {
          maskedKey = '';
          rowError = 'decryption_failed';
        }
      }
    }

    const label = entry?.name ?? provider;

    rows.push({
      provider,
      maskedKey,
      baseUrl: entry?.baseUrl ?? null,
      isActive: cfg.activeProvider === provider,
      label,
      name: entry?.name ?? label,
      wire: entry?.wire ?? 'openai-chat',
      models: entry?.models ?? [],
      // Missing secrets count as configured only for providers that explicitly
      // declare keyless mode in their capabilities.
      hasKey: ref !== undefined || isKeylessProviderAllowed(provider, entry),
      keyless: ref === undefined && isKeylessProviderAllowed(provider, entry),
      ...(entry?.reasoningLevel !== undefined ? { reasoningLevel: entry.reasoningLevel } : {}),
      ...(entry?.tlsRejectUnauthorized === true ? { tlsRejectUnauthorized: true } : {}),
      ...(rowError !== undefined ? { error: rowError } : {}),
    });
  }

  return rows;
}

export interface DeleteProviderResult {
  /** null means tombstone: all providers removed, onboarding should re-run. */
  nextActive: string | null;
  modelPrimary: string;
}

/**
 * Pure helper: given the current config and the provider to remove, computes
 * what the next active provider and model values should be.
 */
export function computeDeleteProviderResult(cfg: Config, toDelete: string): DeleteProviderResult {
  const remaining = Object.keys(cfg.providers).filter(
    (p) =>
      p !== toDelete &&
      (cfg.secrets[p] !== undefined || isKeylessProviderAllowed(p, resolveEntryFor(cfg, p))),
  );

  if (remaining.length === 0) {
    return { nextActive: null, modelPrimary: '' };
  }

  const keepCurrent = cfg.activeProvider !== toDelete && remaining.includes(cfg.activeProvider);
  const nextActive = keepCurrent ? cfg.activeProvider : (remaining[0] as string);

  if (keepCurrent) {
    return { nextActive, modelPrimary: cfg.activeModel };
  }

  const entry = resolveEntryFor(cfg, nextActive);
  return {
    nextActive,
    modelPrimary: entry?.models[0] ?? '',
  };
}

/**
 * Result of resolving which provider/model to call against, given the canonical
 * cached config and the renderer's hint payload.
 */
export interface ActiveModelResolution {
  model: ModelRef;
  baseUrl: string | null;
  wire: WireApi;
  httpHeaders: Record<string, string> | undefined;
  queryParams: Record<string, string> | undefined;
  reasoningLevel: ReasoningLevel | undefined;
  allowKeyless: boolean;
  /** True when the renderer-supplied hint provider didn't match the canonical active. */
  overridden: boolean;
}

export function resolveActiveModel(
  cfg: Config,
  hint: { provider: string; modelId: string },
): ActiveModelResolution {
  const activeId = cfg.activeProvider;
  const entry = resolveEntryFor(cfg, activeId);
  if (entry === null) {
    throw new CodesignError(
      `Active provider "${activeId}" has no provider entry on disk.`,
      ERROR_CODES.PROVIDER_NOT_SUPPORTED,
    );
  }
  const allowKeyless = isKeylessProviderAllowed(activeId, entry);
  if (cfg.secrets[activeId] === undefined && !allowKeyless) {
    throw new CodesignError(
      `No API key stored for active provider "${activeId}". Add one in Settings.`,
      ERROR_CODES.PROVIDER_KEY_MISSING,
    );
  }
  const overridden = activeId !== hint.provider;
  // Guard against a hand-edited config whose activeModel drifted out of the
  // entry's manually-configured list — fall back to the first listed model.
  const hinted = overridden ? cfg.activeModel : hint.modelId;
  const modelId = entry.models.includes(hinted) ? hinted : (entry.models[0] ?? cfg.activeModel);
  return {
    model: { provider: activeId, modelId },
    baseUrl: entry.baseUrl,
    wire: entry.wire,
    httpHeaders: entry.httpHeaders,
    queryParams: entry.queryParams,
    reasoningLevel: entry.reasoningLevel,
    allowKeyless,
    overridden,
  };
}
