import { initI18n } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from './store';

const SOURCE: Design = {
  schemaVersion: 1,
  id: 'design-1',
  name: 'Test design',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  thumbnailText: null,
  deletedAt: null,
  workspacePath: '/tmp/open-codesign-continue-test',
};

const CONTINUED: Design = {
  ...SOURCE,
  id: 'design-2',
  name: 'Test design — continued',
};

const initialState = useCodesignStore.getState();

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  vi.unstubAllGlobals();
  useCodesignStore.setState({
    ...initialState,
    designs: [SOURCE],
    designsLoaded: true,
    currentDesignId: SOURCE.id,
    toasts: [],
    switchDesign: vi.fn(async () => {}),
    loadDesigns: initialState.loadDesigns,
  });
});

describe('continueDesign action', () => {
  it('calls the IPC with the template name, reloads, toasts, and switches', async () => {
    const continueDesignIpc = vi.fn(async () => CONTINUED);
    const listDesigns = vi.fn(async () => [SOURCE, CONTINUED]);
    vi.stubGlobal('window', {
      codesign: {
        snapshots: { continueDesign: continueDesignIpc, listDesigns },
      },
    });

    const result = await useCodesignStore.getState().continueDesign(SOURCE.id);

    expect(result).toEqual(CONTINUED);
    expect(continueDesignIpc).toHaveBeenCalledWith(SOURCE.id, 'Test design — continued');
    expect(listDesigns).toHaveBeenCalled();
    expect(useCodesignStore.getState().designs).toEqual([SOURCE, CONTINUED]);
    expect(useCodesignStore.getState().toasts.at(-1)?.variant).toBe('success');
    expect(useCodesignStore.getState().switchDesign).toHaveBeenCalledWith(CONTINUED.id);
  });

  it('returns null without calling the IPC when the source design is missing', async () => {
    const continueDesignIpc = vi.fn(async () => CONTINUED);
    vi.stubGlobal('window', {
      codesign: {
        snapshots: { continueDesign: continueDesignIpc },
      },
    });

    const result = await useCodesignStore.getState().continueDesign('missing-id');

    expect(result).toBeNull();
    expect(continueDesignIpc).not.toHaveBeenCalled();
    expect(useCodesignStore.getState().switchDesign).not.toHaveBeenCalled();
  });

  it('blocks continuation while the source design is generating', async () => {
    const continueDesignIpc = vi.fn(async () => CONTINUED);
    vi.stubGlobal('window', {
      codesign: {
        snapshots: { continueDesign: continueDesignIpc },
      },
    });
    useCodesignStore.setState({
      generationByDesign: { [SOURCE.id]: { generationId: 'gen-1', stage: 'streaming' } },
    });

    const result = await useCodesignStore.getState().continueDesign(SOURCE.id);

    expect(result).toBeNull();
    expect(continueDesignIpc).not.toHaveBeenCalled();
    const toast = useCodesignStore.getState().toasts.at(-1);
    expect(toast?.variant).toBe('info');
    expect(toast?.title).toBe(
      'Wait for the current generation to finish before starting a new session',
    );
    expect(useCodesignStore.getState().switchDesign).not.toHaveBeenCalled();
  });

  it('blocks continuation while a sibling design on the same workspace is generating', async () => {
    const continueDesignIpc = vi.fn(async () => CONTINUED);
    vi.stubGlobal('window', {
      codesign: {
        snapshots: { continueDesign: continueDesignIpc },
      },
    });
    useCodesignStore.setState({
      designs: [SOURCE, CONTINUED],
      generationByDesign: { [CONTINUED.id]: { generationId: 'gen-1', stage: 'thinking' } },
    });

    const result = await useCodesignStore.getState().continueDesign(SOURCE.id);

    expect(result).toBeNull();
    expect(continueDesignIpc).not.toHaveBeenCalled();
    const toast = useCodesignStore.getState().toasts.at(-1);
    expect(toast?.variant).toBe('info');
    expect(toast?.title).toBe(
      'Wait for the current generation to finish before starting a new session',
    );
    expect(useCodesignStore.getState().switchDesign).not.toHaveBeenCalled();
  });

  it('strips a previous continuation suffix instead of stacking it', async () => {
    const second: Design = { ...SOURCE, id: 'design-3', name: 'Test design — continued (2)' };
    const continueDesignIpc = vi.fn(async () => second);
    vi.stubGlobal('window', {
      codesign: {
        snapshots: { continueDesign: continueDesignIpc, listDesigns: vi.fn(async () => [SOURCE]) },
      },
    });
    useCodesignStore.setState({ designs: [SOURCE, CONTINUED] });

    const result = await useCodesignStore.getState().continueDesign(CONTINUED.id);

    expect(result).toEqual(second);
    expect(continueDesignIpc).toHaveBeenCalledWith(CONTINUED.id, 'Test design — continued (2)');
  });

  it('strips a dedupe number and reuses the un-numbered name when free', async () => {
    const numbered: Design = { ...SOURCE, id: 'design-2', name: 'Test design — continued (2)' };
    const continued: Design = { ...SOURCE, id: 'design-3', name: 'Test design — continued' };
    const continueDesignIpc = vi.fn(async () => continued);
    vi.stubGlobal('window', {
      codesign: {
        snapshots: { continueDesign: continueDesignIpc, listDesigns: vi.fn(async () => [SOURCE]) },
      },
    });
    useCodesignStore.setState({ designs: [numbered] });

    await useCodesignStore.getState().continueDesign(numbered.id);

    expect(continueDesignIpc).toHaveBeenCalledWith(numbered.id, 'Test design — continued');
  });

  it('toasts an error and does not switch when the IPC rejects', async () => {
    const continueDesignIpc = vi.fn(async () => {
      throw new Error('Source design is not bound to a workspace');
    });
    vi.stubGlobal('window', {
      codesign: {
        snapshots: { continueDesign: continueDesignIpc, listDesigns: vi.fn(async () => [SOURCE]) },
      },
    });

    const result = await useCodesignStore.getState().continueDesign(SOURCE.id);

    expect(result).toBeNull();
    const toast = useCodesignStore.getState().toasts.at(-1);
    expect(toast?.variant).toBe('error');
    expect(useCodesignStore.getState().switchDesign).not.toHaveBeenCalled();
  });
});
