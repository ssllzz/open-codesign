import { CodesignError, ERROR_CODES, type OnboardingState } from '@open-codesign/shared';
import { ipcMain } from '../electron-runtime';
import type { ProviderRow } from '../provider-settings';
import type { AppPaths } from '../storage-settings';
import { getCachedConfig, toState } from './config-cache';
import { parseAddProviderPayload, parseUpdateProviderPayload } from './provider-parsers';
import {
  runAddCustomProvider,
  runDeleteProvider,
  runListProviders,
  runSetActiveProvider,
  runUpdateProvider,
} from './providers-crud';
import { runChooseStorageFolder, runGetPaths, runOpenFolder, runResetOnboarding } from './storage';

export function registerOnboardingIpc(): void {
  ipcMain.handle('onboarding:get-state', (): OnboardingState => toState(getCachedConfig()));

  // ── v3 custom provider IPC surface ────────────────────────────────────────

  ipcMain.handle('config:v1:add-provider', async (_e, raw: unknown): Promise<OnboardingState> => {
    return runAddCustomProvider(parseAddProviderPayload(raw));
  });

  ipcMain.handle(
    'config:v1:update-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      return runUpdateProvider(parseUpdateProviderPayload(raw));
    },
  );

  ipcMain.handle(
    'config:v1:remove-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new CodesignError(
          'config:v1:remove-provider expects a provider id',
          ERROR_CODES.IPC_BAD_INPUT,
        );
      }
      await runDeleteProvider(raw);
      return toState(getCachedConfig());
    },
  );

  ipcMain.handle(
    'config:v1:set-active-provider-and-model',
    async (_e, raw: unknown): Promise<OnboardingState> => {
      return runSetActiveProvider(raw);
    },
  );

  // ── Settings v1 channels ────────────────────────────────────────────────────

  ipcMain.handle(
    'settings:v1:list-providers',
    async (): Promise<ProviderRow[]> => runListProviders(),
  );

  ipcMain.handle(
    'settings:v1:delete-provider',
    async (_e, raw: unknown): Promise<ProviderRow[]> => runDeleteProvider(raw),
  );

  ipcMain.handle(
    'settings:v1:set-active-provider',
    async (_e, raw: unknown): Promise<OnboardingState> => runSetActiveProvider(raw),
  );

  ipcMain.handle('settings:v1:get-paths', async (): Promise<AppPaths> => runGetPaths());

  ipcMain.handle(
    'settings:v1:choose-storage-folder',
    async (_e, raw: unknown): Promise<AppPaths> => runChooseStorageFolder(raw),
  );

  ipcMain.handle(
    'settings:v1:open-folder',
    async (_e, raw: unknown): Promise<void> => runOpenFolder(raw),
  );

  ipcMain.handle('settings:v1:reset-onboarding', async (): Promise<void> => runResetOnboarding());

  ipcMain.handle('settings:v1:toggle-devtools', (_e) => {
    _e.sender.toggleDevTools();
  });
}
