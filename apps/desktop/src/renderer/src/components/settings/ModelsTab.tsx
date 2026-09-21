import { useT } from '@open-codesign/i18n';
import { Button } from '@open-codesign/ui';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProviderRow } from '../../../../preload/index';
import { recordAction } from '../../lib/action-timeline';
import { useCodesignStore } from '../../store';
import { AddCustomProviderModal } from '../AddCustomProviderModal';
import { cleanIpcError, ProviderCard, SectionTitle } from './primitives';

export function ModelsTab() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const reportableErrorToast = useCodesignStore((s) => s.reportableErrorToast);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCustom, setShowAddCustom] = useState(false);
  /** Edit-mode target. */
  const [editingRow, setEditingRow] = useState<ProviderRow | null>(null);

  function handleEdit(row: ProviderRow) {
    setEditingRow(row);
  }

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.settings
      .listProviders()
      .then(setRows)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.providers.toast.loadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      })
      .finally(() => setLoading(false));
  }, [pushToast, t]);

  async function reloadRows() {
    if (!window.codesign) return;
    const [nextRows, state] = await Promise.all([
      window.codesign.settings.listProviders(),
      window.codesign.onboarding.getState(),
    ]);
    setRows(nextRows);
    setConfig(state);
  }

  async function handleDelete(provider: string) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.settings.deleteProvider(provider);
      setRows(next);
      const newState = await window.codesign.onboarding.getState();
      setConfig(newState);
      pushToast({ variant: 'success', title: t('settings.providers.toast.removed') });
    } catch (err) {
      reportableErrorToast({
        code: 'PROVIDER_DELETE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.deleteFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleActivate(provider: string) {
    if (!window.codesign) return;
    const currentRow = rows.find((r) => r.provider === provider);
    const defaultModel = currentRow?.models[0] || config?.modelPrimary || '';
    const label = currentRow?.label ?? provider;
    if (defaultModel.length === 0) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.activateFailed'),
        description: t('settings.providers.toast.missingModel'),
      });
      return;
    }
    try {
      const next = await window.codesign.settings.setActiveProvider({
        provider,
        modelPrimary: defaultModel,
      });
      recordAction({
        type: 'provider.switch',
        data: { provider, modelId: defaultModel },
      });
      setConfig(next);
      const updatedRows = await window.codesign.settings.listProviders();
      setRows(updatedRows);
      pushToast({
        variant: 'success',
        title: t('settings.providers.toast.switchedTo', { label }),
      });
    } catch (err) {
      reportableErrorToast({
        code: 'PROVIDER_ACTIVATE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.switchFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  return (
    <>
      {showAddCustom && (
        <AddCustomProviderModal
          onSave={async () => {
            setShowAddCustom(false);
            await reloadRows();
            pushToast({ variant: 'success', title: t('settings.providers.toast.saved') });
          }}
          onClose={() => setShowAddCustom(false)}
        />
      )}

      {editingRow !== null && (
        <AddCustomProviderModal
          onSave={async () => {
            setEditingRow(null);
            await reloadRows();
            pushToast({ variant: 'success', title: t('settings.providers.toast.saved') });
          }}
          onClose={() => setEditingRow(null)}
          editTarget={{
            id: editingRow.provider,
            name: editingRow.name,
            baseUrl: editingRow.baseUrl ?? '',
            wire: editingRow.wire,
            models: editingRow.models,
            keyless: editingRow.keyless,
            ...(editingRow.maskedKey.length > 0 ? { keyMask: editingRow.maskedKey } : {}),
            ...(editingRow.tlsRejectUnauthorized === true ? { tlsRejectUnauthorized: true } : {}),
          }}
          initialSetAsActive={false}
        />
      )}

      <div className="space-y-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)] min-h-[var(--size-control-sm)]">
          <SectionTitle>{t('settings.providers.sectionTitle')}</SectionTitle>
          <Button variant="secondary" size="sm" onClick={() => setShowAddCustom(true)}>
            <Plus className="w-3.5 h-3.5" />
            {t('settings.providers.addProvider')}
          </Button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-4 text-[var(--text-sm)] text-[var(--color-text-muted)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('settings.common.loading')}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
            {t('settings.providers.empty')}
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((row) => (
              <ProviderCard
                key={row.provider}
                row={row}
                config={config}
                onDelete={handleDelete}
                onActivate={handleActivate}
                onEdit={handleEdit}
                onRowChanged={(next) =>
                  setRows((prev) => prev.map((r) => (r.provider === next.provider ? next : r)))
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
