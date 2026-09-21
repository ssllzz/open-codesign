import { useT } from '@open-codesign/i18n';
import { canonicalBaseUrl, detectWireFromBaseUrl, type WireApi } from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';

interface Props {
  onSave: () => void;
  onClose: () => void;
  /** When true, render as the primary/active provider after save. */
  initialSetAsActive?: boolean;
  /**
   * Edit-mode: pre-fill every field from an existing provider and save via
   * `updateProvider` (keeps id stable, rotates secret only when user types
   * a new key). When undefined, falls back to create-mode.
   */
  editTarget?: {
    id: string;
    name: string;
    baseUrl: string;
    wire: WireApi;
    models: string[];
    /** True when the stored entry is keyless (no secret). */
    keyless?: boolean;
    /** Display mask of existing key (e.g. "sk-ant-***xyz9") — shown as
     *  placeholder so user knows there's a stored key, and an empty submit
     *  doesn't wipe it. */
    keyMask?: string;
    /** Existing per-provider TLS verification opt-out, so the checkbox can
     *  start in the right state when re-opening Edit. */
    tlsRejectUnauthorized?: boolean;
  };
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; reply?: string }
  | { kind: 'error'; message: string };

/** Parse the free-form models field: comma / whitespace / newline separated IDs. */
export function parseModelsInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((m) => m.trim())
        .filter((m) => m.length > 0),
    ),
  ];
}

export function buildKeylessPayload(
  keyless: boolean,
  apiKey: string,
): { keyless: boolean; apiKey: string } {
  return { keyless, apiKey: keyless ? '' : apiKey.trim() };
}

/**
 * Custom Provider form — wire-agnostic, API-key-only onboarding with manually
 * entered model IDs. The "Test" button sends one tiny real generation through
 * the first listed model, so key + baseUrl + model are verified together
 * (works for gateways that expose no /models listing).
 */
export function AddCustomProviderModal({
  onSave,
  onClose,
  initialSetAsActive = true,
  editTarget,
}: Props) {
  const t = useT();
  const isEdit = editTarget !== undefined;
  const [name, setName] = useState(editTarget?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(editTarget?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [keyless, setKeyless] = useState(editTarget?.keyless === true);
  const [modelsText, setModelsText] = useState(editTarget?.models.join(', ') ?? '');
  const [wire, setWire] = useState<WireApi>(editTarget?.wire ?? 'openai-chat');
  // In edit mode we trust the stored wire; in create mode we auto-detect from
  // the pasted URL until the user picks one explicitly.
  const [wireAuto, setWireAuto] = useState(!isEdit);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);
  // Per-provider TLS verification opt-out.
  const [tlsRejectUnauthorized, setTlsRejectUnauthorized] = useState(
    editTarget?.tlsRejectUnauthorized === true,
  );
  // Acknowledge the security warning once per modal session so re-toggling
  // doesn't re-prompt.
  const tlsConfirmed = useRef(editTarget?.tlsRejectUnauthorized === true);

  const models = parseModelsInput(modelsText);

  function handleBaseUrlChange(v: string) {
    setBaseUrl(v);
    if (wireAuto) setWire(detectWireFromBaseUrl(v));
    setTest({ kind: 'idle' });
  }

  function handleWireChange(v: WireApi) {
    setWire(v);
    setWireAuto(false);
    setTest({ kind: 'idle' });
  }

  function handleTlsToggle(nextChecked: boolean) {
    if (!nextChecked) {
      setTlsRejectUnauthorized(false);
      setTest({ kind: 'idle' });
      return;
    }
    // window.confirm matches the existing in-renderer confirmation pattern —
    // packages/ui ships no AlertDialog primitive and adding Radix here would
    // introduce a dep for a single one-shot prompt.
    if (tlsConfirmed.current) {
      setTlsRejectUnauthorized(true);
      setTest({ kind: 'idle' });
      return;
    }
    const ok = window.confirm(
      `${t('settings.providers.tlsRejectUnauthorized.confirmTitle')}\n\n${t(
        'settings.providers.tlsRejectUnauthorized.confirmBody',
      )}`,
    );
    if (!ok) return;
    tlsConfirmed.current = true;
    setTlsRejectUnauthorized(true);
    setTest({ kind: 'idle' });
  }

  async function handleTest() {
    if (!window.codesign?.config) return;
    const firstModel = models[0];
    if (baseUrl.trim().length === 0 || firstModel === undefined) return;
    setTest({ kind: 'testing' });
    try {
      const res = await window.codesign.config.testEndpoint({
        wire,
        baseUrl: baseUrl.trim(),
        model: firstModel,
        ...buildKeylessPayload(keyless, apiKey),
        allowPrivateNetwork,
        ...(tlsRejectUnauthorized ? { tlsRejectUnauthorized: true } : {}),
      });
      if (res.ok) {
        setTest({ kind: 'ok', ...(res.reply !== undefined ? { reply: res.reply } : {}) });
      } else setTest({ kind: 'error', message: res.message });
    } catch (err) {
      setTest({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleSave() {
    if (!window.codesign?.config) return;
    setSaving(true);
    setError(null);
    try {
      if (isEdit && editTarget !== undefined) {
        // Edit mode: reuse id, rotate secret only when user typed something.
        // Omitting `apiKey` leaves the stored secret untouched — matching the
        // "leave empty to keep current key" UX hinted at by the mask placeholder.
        const update: Parameters<NonNullable<typeof window.codesign.config.updateProvider>>[0] = {
          id: editTarget.id,
        };
        if (name.trim() !== editTarget.name) update.name = name.trim() || editTarget.id;
        if (models.length > 0 && models.join('\u0000') !== editTarget.models.join('\u0000')) {
          update.models = models;
        }
        if (baseUrl.trim() !== editTarget.baseUrl) {
          update.baseUrl = canonicalBaseUrl(baseUrl.trim(), wire);
        }
        if (wire !== editTarget.wire) update.wire = wire;
        if (apiKey.trim().length > 0) update.apiKey = apiKey.trim();
        // Keyless mode flip: switching to keyless without a typed key sends
        // an explicit empty apiKey so the stored secret is cleared. Switching
        // back to keyed without a new key is rejected server-side by
        // runUpdateProvider's "No API key stored" guard — surfaced as a form
        // error rather than pre-validated here.
        const wasKeyless = editTarget.keyless === true;
        if (keyless !== wasKeyless) {
          update.keyless = keyless;
          if (keyless && apiKey.trim().length === 0) update.apiKey = '';
        }
        const previous = editTarget.tlsRejectUnauthorized === true;
        if (previous !== tlsRejectUnauthorized) {
          update.tlsRejectUnauthorized = !!tlsRejectUnauthorized;
        }
        await window.codesign.config.updateProvider(update);
      } else {
        const slug = slugify(name);
        const id = `custom-${slug}-${Date.now().toString(36).slice(-4)}`;
        await window.codesign.config.addProvider({
          id,
          name: name.trim() || id,
          wire,
          baseUrl: canonicalBaseUrl(baseUrl.trim(), wire),
          ...buildKeylessPayload(keyless, apiKey),
          models,
          setAsActive: initialSetAsActive,
          ...(tlsRejectUnauthorized ? { tlsRejectUnauthorized: true } : {}),
        });
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const canTest =
    baseUrl.trim().length > 0 &&
    models.length > 0 &&
    (keyless || apiKey.trim().length > 0) &&
    test.kind !== 'testing';
  const canSave = (() => {
    if (saving) return false;
    const hasKey =
      keyless ||
      apiKey.trim().length > 0 ||
      (isEdit && (!!editTarget?.keyMask || editTarget?.keyless === true));
    return baseUrl.trim().length > 0 && models.length > 0 && name.trim().length > 0 && hasKey;
  })();

  const title = isEdit
    ? t('settings.providers.custom.editTitle')
    : t('settings.providers.custom.title');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-[var(--color-overlay)]"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="w-full max-w-md max-h-full overflow-y-auto bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-[var(--shadow-elevated)] p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[var(--text-base)] font-semibold text-[var(--color-text-primary)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <Field label={t('settings.providers.custom.wire')}>
          <div className="flex gap-3 flex-wrap">
            {(['openai-chat', 'openai-responses', 'anthropic'] as const).map((w) => (
              <label
                key={w}
                className="inline-flex items-center gap-1.5 text-[var(--text-xs)] cursor-pointer"
              >
                <input
                  type="radio"
                  name="wire"
                  value={w}
                  checked={wire === w}
                  onChange={() => handleWireChange(w)}
                  className="accent-[var(--color-accent)]"
                />
                <span className="text-[var(--color-text-secondary)]">
                  {t(`settings.providers.custom.wires.${w}`)}
                </span>
              </label>
            ))}
          </div>
        </Field>

        <Field label={t('settings.providers.custom.name')}>
          <TextInput value={name} onChange={setName} placeholder="My Provider" />
        </Field>

        <Field label={t('settings.providers.custom.baseUrl')}>
          <TextInput
            value={baseUrl}
            onChange={handleBaseUrlChange}
            placeholder="https://api.example.com/v1"
          />
          <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] px-3 py-2 text-[var(--text-xs)] text-[var(--color-text-secondary)]">
            <div className="flex items-center gap-1.5 font-medium text-[var(--color-text-primary)]">
              <AlertCircle className="w-3.5 h-3.5 text-[var(--color-warning)]" />
              <span>{t('settings.providers.custom.compatibilityHintTitle')}</span>
            </div>
            <p className="mt-1 leading-5">{t('settings.providers.custom.compatibilityHintBody')}</p>
          </div>
          <label className="mt-2 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] px-3 py-2 text-[var(--text-xs)] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={allowPrivateNetwork}
              onChange={(e) => {
                setAllowPrivateNetwork(e.target.checked);
                setTest({ kind: 'idle' });
              }}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              {t('settings.providers.custom.allowPrivateNetwork', {
                defaultValue:
                  'Allow testing local or private-network provider URLs from this computer',
              })}
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] px-3 py-2 text-[var(--text-xs)] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={tlsRejectUnauthorized}
              onChange={(e) => handleTlsToggle(e.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium text-[var(--color-text-primary)]">
                {t('settings.providers.tlsRejectUnauthorized.label')}
              </span>
              <span className="text-[var(--color-text-muted)]">
                {t('settings.providers.tlsRejectUnauthorized.description')}
              </span>
            </span>
          </label>
        </Field>

        <label className="flex items-start gap-2 text-[var(--text-xs)] text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            checked={keyless}
            onChange={(e) => {
              setKeyless(e.target.checked);
              setTest({ kind: 'idle' });
            }}
            className="mt-0.5 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block font-medium">{t('settings.providers.custom.keylessLabel')}</span>
            <span>{t('settings.providers.custom.keylessDescription')}</span>
          </span>
        </label>
        <Field label={t('settings.providers.custom.apiKey')}>
          <TextInput
            value={apiKey}
            onChange={(v) => {
              setApiKey(v);
              setTest({ kind: 'idle' });
            }}
            type="password"
            disabled={keyless}
            placeholder={
              isEdit && editTarget?.keyMask !== undefined && editTarget.keyMask.length > 0
                ? t('settings.providers.custom.apiKeyEditPlaceholder', {
                    mask: editTarget.keyMask,
                  })
                : 'sk-...'
            }
          />
        </Field>

        <Field label={t('settings.providers.custom.models')}>
          <textarea
            value={modelsText}
            onChange={(e) => {
              setModelsText(e.target.value);
              setTest({ kind: 'idle' });
            }}
            placeholder="kimi-k2.8-preview, glm-5.2"
            rows={2}
            className="w-full px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] resize-y"
          />
          <p className="mt-1 text-[var(--text-xs)] text-[var(--color-text-muted)]">
            {t('settings.providers.custom.modelsHint')}
          </p>
        </Field>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={!canTest}
            className="h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
          >
            {test.kind === 'testing' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : test.kind === 'ok' ? (
              <CheckCircle className="w-3.5 h-3.5 text-[var(--color-success)]" />
            ) : test.kind === 'error' ? (
              <AlertCircle className="w-3.5 h-3.5 text-[var(--color-error)]" />
            ) : null}
            {t('settings.providers.custom.test')}
          </button>
          {test.kind === 'ok' && (
            <span className="text-[var(--text-xs)] text-[var(--color-success)] truncate">
              {t('settings.providers.custom.testOk', {
                defaultValue: 'Connected — model replied',
                reply: test.reply ?? '',
              })}
            </span>
          )}
          {test.kind === 'error' && (
            <span className="text-[var(--text-xs)] text-[var(--color-error)] truncate">
              {test.message}
            </span>
          )}
        </div>

        {error !== null && (
          <p className="text-[var(--text-xs)] text-[var(--color-error)]">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {isEdit ? t('settings.providers.custom.saveEdit') : t('settings.providers.custom.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)]">
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled === true}
      className="w-full h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-60 disabled:cursor-not-allowed"
    />
  );
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'custom'
  );
}
