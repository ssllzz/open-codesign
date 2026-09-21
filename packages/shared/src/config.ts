import { z } from 'zod';

// ── Legacy enum (v1/v2) — kept for backward compat & UI shortlist ─────────────

const ProviderIdEnum = z.enum([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'cerebras',
  'xai',
  'mistral',
  'amazon-bedrock',
  'azure-openai-responses',
  'vercel-ai-gateway',
]);

// ── Wire types ───────────────────────────────────────────────────────────────

export const WireApiSchema = z.enum(['openai-chat', 'openai-responses', 'anthropic']);
export type WireApi = z.infer<typeof WireApiSchema>;

// ── Secrets & StoredDesignSystem ─────────────────────────────────────────────

export const SecretRef = z
  .object({
    ciphertext: z.string().min(1),
    /**
     * Display-only mask like "sk-ant-***xyz9". Persisted at save time so the
     * Settings page can render the row without calling `safeStorage.decryptString`
     * (which on unsigned macOS builds triggers a keychain password prompt).
     * Optional for backwards compat: older configs without a mask will be
     * migrated on first read by decrypting once and writing the mask back.
     */
    mask: z.string().optional(),
  })
  .strict();
export type SecretRef = z.infer<typeof SecretRef>;

export const BaseUrlRef = z
  .object({
    baseUrl: z.string().url(),
  })
  .strict();
export type BaseUrlRef = z.infer<typeof BaseUrlRef>;

export const STORED_DESIGN_SYSTEM_SCHEMA_VERSION = 1 as const;

const StoredDesignSystemShape = z
  .object({
    schemaVersion: z.literal(STORED_DESIGN_SYSTEM_SCHEMA_VERSION),
    rootPath: z.string().min(1),
    summary: z.string().min(1),
    extractedAt: z.string().min(1),
    sourceFiles: z.array(z.string().min(1)).max(24).default([]),
    colors: z.array(z.string().min(1)).max(24).default([]),
    fonts: z.array(z.string().min(1)).max(16).default([]),
    spacing: z.array(z.string().min(1)).max(16).default([]),
    radius: z.array(z.string().min(1)).max(16).default([]),
    shadows: z.array(z.string().min(1)).max(16).default([]),
  })
  .strict();

export const StoredDesignSystem = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if ('schemaVersion' in record) return record;
  return { schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION, ...record };
}, StoredDesignSystemShape);
export type StoredDesignSystem = z.infer<typeof StoredDesignSystem>;

// ── ProviderEntry (v3) ───────────────────────────────────────────────────────

export const ReasoningLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;

export const ProviderCapabilitiesSchema = z
  .object({
    /** Persisted signal for keyless endpoints (local gateways, etc.). When
     * absent the provider requires a stored API key. */
    supportsKeyless: z.boolean().optional(),
    supportsReasoning: z.boolean().optional(),
  })
  .strict();
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const IMAGE_GENERATION_SCHEMA_VERSION = 1 as const;

export const ImageGenerationProviderSchema = z.enum(['openai', 'openrouter']);
export type ImageGenerationProvider = z.infer<typeof ImageGenerationProviderSchema>;

export const ImageGenerationCredentialModeSchema = z.enum(['inherit', 'custom']);
export type ImageGenerationCredentialMode = z.infer<typeof ImageGenerationCredentialModeSchema>;

export const ImageGenerationQualitySchema = z.enum(['auto', 'low', 'medium', 'high']);
export type ImageGenerationQuality = z.infer<typeof ImageGenerationQualitySchema>;

export const ImageGenerationSizeSchema = z.enum(['auto', '1024x1024', '1536x1024', '1024x1536']);
export type ImageGenerationSize = z.infer<typeof ImageGenerationSizeSchema>;

export const ImageGenerationOutputFormatSchema = z.enum(['png', 'jpeg', 'webp']);
export type ImageGenerationOutputFormat = z.infer<typeof ImageGenerationOutputFormatSchema>;

export const ImageGenerationSettingsSchema = z
  .object({
    schemaVersion: z.literal(IMAGE_GENERATION_SCHEMA_VERSION),
    enabled: z.boolean().default(false),
    provider: ImageGenerationProviderSchema.default('openai'),
    credentialMode: ImageGenerationCredentialModeSchema.default('inherit'),
    model: z.string().min(1).default('gpt-image-2'),
    baseUrl: z.string().url().optional(),
    apiKey: SecretRef.optional(),
    quality: ImageGenerationQualitySchema.default('high'),
    size: ImageGenerationSizeSchema.default('1536x1024'),
    outputFormat: ImageGenerationOutputFormatSchema.default('png'),
  })
  .strict();
export type ImageGenerationSettings = z.infer<typeof ImageGenerationSettingsSchema>;

export const ProviderEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    wire: WireApiSchema,
    baseUrl: z.string().url(),
    /** Manually entered model IDs — the single source of truth for the model
     * switcher. No /models auto-discovery in v4. */
    models: z.array(z.string().min(1)).min(1),
    envKey: z.string().min(1).optional(),
    httpHeaders: z.record(z.string(), z.string()).optional(),
    queryParams: z.record(z.string(), z.string()).optional(),
    /**
     * Per-provider reasoning effort override. When set, overrides the
     * model-family default from `reasoningForModel` in core. Useful for
     * proxies that gate reasoning tiers by plan (Claude Code consumer-tier
     * accepts only 'medium') or for users who want to dial depth up/down
     * per endpoint. The UI surfaces this as a "Reasoning depth" dropdown.
     */
    reasoningLevel: ReasoningLevelSchema.optional(),
    capabilities: ProviderCapabilitiesSchema.optional(),
    /**
     * Per-provider opt-in to skip TLS certificate verification on outbound
     * HTTPS requests for this provider. Intended for users on corporate
     * networks whose internal OpenAI-compatible gateways are served with
     * self-signed or private-CA certificates that Node's default trust
     * store rejects. See issue #229.
     */
    tlsRejectUnauthorized: z.boolean().optional(),
  })
  .strict();
export type ProviderEntry = z.infer<typeof ProviderEntrySchema>;

interface ProviderCapabilityInput {
  wire: WireApi;
  reasoningLevel?: ReasoningLevel | undefined;
  capabilities?: ProviderCapabilities | undefined;
}

export function resolveProviderCapabilities(
  _providerId: string,
  entry: ProviderCapabilityInput,
): Required<ProviderCapabilities> {
  return {
    supportsKeyless: false,
    supportsReasoning:
      (entry.reasoningLevel !== undefined && entry.reasoningLevel !== 'off') ||
      entry.wire === 'anthropic' ||
      entry.wire === 'openai-responses',
    ...(entry.capabilities ?? {}),
  };
}

// ── ConfigSchema v4 — canonical on-disk shape ────────────────────────────────

/**
 * Canonical v4 config shape written to disk. All `writeConfig` calls emit
 * exactly this shape. Reads accept v1/v2/v3 as well (see `parseConfigFlexible`),
 * migrating transparently.
 *
 * The `Config` TypeScript type additionally exposes legacy `provider` /
 * `modelPrimary` / `baseUrls` accessors as read-only derived views — existing
 * consumers keep working without rewrites. These derived fields are NOT
 * persisted. Writers must use v4 fields only.
 */
export const ConfigV4Schema = z
  .object({
    version: z.literal(4),
    // `activeProvider` / `activeModel` are ALLOWED to be empty: that's the
    // legal "no active provider" state the app lands in once the last
    // provider is deleted. Consumers (`toState`, `resolveActiveCredentials`,
    // Settings UI) already branch on hasKey/undefined-entry for this case.
    // The previous `.min(1)` invariant made the empty state unrepresentable
    // on disk — writing it succeeded but the next boot rejected the file,
    // hanging the main process before the window could open.
    activeProvider: z.string(),
    activeModel: z.string(),
    secrets: z.record(z.string(), SecretRef).default({}),
    providers: z.record(z.string(), ProviderEntrySchema).default({}),
    designSystem: StoredDesignSystem.optional(),
    imageGeneration: ImageGenerationSettingsSchema.optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const hasActiveProvider = config.activeProvider.length > 0;
    const hasActiveModel = config.activeModel.length > 0;
    if (!hasActiveProvider && hasActiveModel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['activeModel'],
        message: 'activeModel must be empty when activeProvider is empty',
      });
    }
    if (hasActiveProvider && !hasActiveModel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['activeModel'],
        message: 'activeModel must be non-empty when activeProvider is set',
      });
    }
    if (hasActiveProvider && config.providers[config.activeProvider] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['activeProvider'],
        message: `activeProvider "${config.activeProvider}" has no provider entry`,
      });
    }
  });
export type ConfigV4 = z.infer<typeof ConfigV4Schema>;

/**
 * Runtime config view — v4 on disk, plus derived legacy accessors for
 * backward compat with v0.1 consumer code. Only the v4 fields are written.
 */
export interface Config extends ConfigV4 {
  /** @deprecated Use `activeProvider`. Derived from v4 state. */
  readonly provider: string;
  /** @deprecated Use `activeModel`. Derived from v4 state. */
  readonly modelPrimary: string;
  /** @deprecated Use `providers[id].baseUrl`. Derived from v4 state. */
  readonly baseUrls: Record<string, BaseUrlRef | undefined>;
}

export const ConfigSchema = ConfigV4Schema;

const LegacyConfigSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).optional(),
  provider: ProviderIdEnum,
  modelPrimary: z.string(),
  modelFast: z.string().optional(),
  secrets: z.partialRecord(ProviderIdEnum, SecretRef).default({}),
  baseUrls: z.partialRecord(ProviderIdEnum, BaseUrlRef).default({}),
  designSystem: StoredDesignSystem.optional(),
});
type LegacyConfig = z.infer<typeof LegacyConfigSchema>;

/** Provider ids whose v3 entries are dropped during v3→v4 migration. */
const REMOVED_PROVIDER_IDS = new Set(['chatgpt-codex']);

function isRemovedV3Entry(id: string, entry: Record<string, unknown>): boolean {
  // The codex wire was removed in v4 and nothing can call it anymore — drop
  // entries carrying it instead of letting the strict v4 parse reject the
  // whole file (which would block boot).
  return (
    REMOVED_PROVIDER_IDS.has(id) ||
    entry['builtin'] === true ||
    entry['wire'] === 'openai-codex-responses'
  );
}

/**
 * Loose v3 entry shape used only as migration input. v4's strict schema would
 * reject v3 fields (builtin/defaultModel/modelsHint/requiresApiKey) before the
 * migrator had a chance to strip them.
 */
const V3EntryLooseSchema = ProviderEntrySchema.partial({ models: true })
  .extend({
    // v3 accepted a codex wire that v4 removed — parse loosely here so the
    // migrator can still read (and drop) entries that carry it.
    wire: z.enum(['openai-chat', 'openai-responses', 'anthropic', 'openai-codex-responses']),
    builtin: z.boolean().optional(),
    defaultModel: z.string().optional(),
    modelsHint: z.array(z.string()).optional(),
    requiresApiKey: z.boolean().optional(),
  })
  .passthrough();

const V3ConfigLooseSchema = z.object({
  version: z.literal(3),
  activeProvider: z.string(),
  activeModel: z.string(),
  secrets: z.record(z.string(), SecretRef).default({}),
  providers: z.record(z.string(), V3EntryLooseSchema).default({}),
  designSystem: StoredDesignSystem.optional(),
  imageGeneration: z.unknown().optional(),
});

/**
 * Pure: migrate a v3 config to v4.
 *
 * - drops builtin-preset entries and the removed chatgpt-codex entry, pruning
 *   their orphaned secrets
 * - folds `defaultModel` + `modelsHint` into the manual `models` list
 * - falls `activeProvider` back to the first surviving provider that has a
 *   secret (or is keyless) so a deleted active entry never leaves a config
 *   that fails superRefine at next boot
 * - drops an `imageGeneration` section pinned to the removed chatgpt-codex
 *   provider instead of letting the narrowed enum reject the whole file
 */
export function migrateV3ToV4(raw: unknown): ConfigV4 {
  const v3 = V3ConfigLooseSchema.parse(raw);
  const providers: Record<string, ProviderEntry> = {};
  for (const [id, loose] of Object.entries(v3.providers)) {
    if (loose === undefined || isRemovedV3Entry(id, loose)) continue;
    const {
      ['builtin']: _b,
      ['defaultModel']: defaultModel,
      ['modelsHint']: modelsHint,
      ['requiresApiKey']: requiresApiKey,
      ...rest
    } = loose;
    const models = [...(defaultModel !== undefined ? [defaultModel] : []), ...(modelsHint ?? [])]
      .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      .filter((m, i, arr) => arr.indexOf(m) === i);
    // An entry without any derivable model id can't satisfy v4's min(1)
    // invariant — skip it (and its secret below) rather than failing the
    // whole migration over one broken row.
    if (models.length === 0) continue;
    const capabilities =
      requiresApiKey === false
        ? { ...(rest.capabilities ?? {}), supportsKeyless: true }
        : rest.capabilities;
    providers[id] = ProviderEntrySchema.parse({
      ...rest,
      ...(capabilities !== undefined ? { capabilities } : {}),
      models,
    });
  }
  const secrets: Record<string, SecretRef> = {};
  for (const [id, ref] of Object.entries(v3.secrets)) {
    if (ref !== undefined && providers[id] !== undefined) secrets[id] = ref;
  }
  let activeProvider = v3.activeProvider;
  if (activeProvider.length === 0 || providers[activeProvider] === undefined) {
    const ids = Object.keys(providers);
    const withSecret = ids.find((id) => secrets[id] !== undefined);
    const keyless = ids.find((id) => providers[id]?.capabilities?.supportsKeyless === true);
    activeProvider = withSecret ?? keyless ?? ids[0] ?? '';
  }
  let activeModel = '';
  if (activeProvider.length > 0) {
    const models = providers[activeProvider]?.models ?? [];
    activeModel = models.includes(v3.activeModel) ? v3.activeModel : (models[0] ?? '');
  }
  const imageGeneration =
    v3.imageGeneration !== undefined &&
    (v3.imageGeneration as { provider?: unknown }).provider !== 'chatgpt-codex'
      ? ImageGenerationSettingsSchema.parse(v3.imageGeneration)
      : undefined;
  const out: ConfigV4 = {
    version: 4,
    activeProvider,
    activeModel,
    secrets,
    providers,
    ...(v3.designSystem !== undefined ? { designSystem: v3.designSystem } : {}),
    ...(imageGeneration !== undefined ? { imageGeneration } : {}),
  };
  return ConfigV4Schema.parse(out);
}

/**
 * Pure: migrate a validated v1/v2 config to v4. The old shape carries no
 * wire/baseUrl per provider, so nothing can be carried into the v4 provider
 * model — land in the legal empty state and let the user re-add providers
 * in Settings. The design system survives.
 */
export function migrateLegacyToV4(legacy: LegacyConfig): ConfigV4 {
  const out: ConfigV4 = {
    version: 4,
    activeProvider: '',
    activeModel: '',
    secrets: {},
    providers: {},
  };
  if (legacy.designSystem !== undefined) out.designSystem = legacy.designSystem;
  return out;
}

/**
 * Single entry point for parsing raw config objects. Detects version and
 * either returns a v4 `Config` directly or runs a migrator first.
 * Always returns the full `Config` runtime view with derived legacy fields.
 */
export function parseConfigFlexible(raw: unknown): Config {
  const v4 = parseV4OrMigrate(raw);
  return hydrateConfig(v4);
}

function parseV4OrMigrate(raw: unknown): ConfigV4 {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return ConfigV4Schema.parse(raw);
  }
  const r = raw as Record<string, unknown>;
  if (r['version'] === 4) {
    return ConfigV4Schema.parse(raw);
  }
  if (r['version'] === 3) {
    return migrateV3ToV4(raw);
  }
  const legacy = LegacyConfigSchema.parse(raw);
  return ConfigV4Schema.parse(migrateLegacyToV4(legacy));
}

/**
 * Attach derived legacy accessors to a bare v4 config. Idempotent.
 */
export function hydrateConfig(v4: ConfigV4): Config {
  const baseUrls: Record<string, BaseUrlRef | undefined> = {};
  for (const [id, entry] of Object.entries(v4.providers)) {
    if (entry !== undefined) baseUrls[id] = { baseUrl: entry.baseUrl };
  }
  return {
    ...v4,
    provider: v4.activeProvider,
    modelPrimary: v4.activeModel,
    baseUrls,
  };
}

/**
 * Strip derived fields before writing to disk. Always returns a pure v4 shape.
 */
export function toPersistedV4(cfg: Config | ConfigV4): ConfigV4 {
  return {
    version: 4,
    activeProvider: cfg.activeProvider,
    activeModel: cfg.activeModel,
    secrets: cfg.secrets,
    providers: cfg.providers,
    ...(cfg.designSystem !== undefined ? { designSystem: cfg.designSystem } : {}),
    ...(cfg.imageGeneration !== undefined ? { imageGeneration: cfg.imageGeneration } : {}),
  };
}

// ── OnboardingState ──────────────────────────────────────────────────────────

export interface OnboardingState {
  hasKey: boolean;
  provider: string | null;
  modelPrimary: string | null;
  baseUrl: string | null;
  designSystem: StoredDesignSystem | null;
}

/**
 * Auto-detect a sensible wire from a base URL. Used by the Custom provider
 * form to preselect the radio — user can always override.
 */
export function detectWireFromBaseUrl(baseUrl: string): WireApi {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('anthropic')) return 'anthropic';
  let host = '';
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const isAzureOpenAiHost = host === 'openai.azure.com' || host.endsWith('.openai.azure.com');
  if (isAzureOpenAiHost || lower.includes('/responses')) {
    return 'openai-responses';
  }
  return 'openai-chat';
}
