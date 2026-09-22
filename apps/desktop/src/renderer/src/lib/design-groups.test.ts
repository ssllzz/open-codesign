import type { Design } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { folderRepresentative, groupDesignsByWorkspace, sortDesignsForList } from './design-groups';

function makeDesign(overrides: Partial<Design> & { id: string }): Design {
  return {
    schemaVersion: 1,
    name: `Design ${overrides.id}`,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    thumbnailText: null,
    deletedAt: null,
    workspacePath: null,
    ...overrides,
  };
}

const SERIES_PATH = 'C:/Users/0/Documents/CoDesign/website';

describe('groupDesignsByWorkspace', () => {
  it('groups designs sharing one workspace into a single series', () => {
    const source = makeDesign({
      id: 'a',
      workspacePath: SERIES_PATH,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const continued = makeDesign({
      id: 'b',
      name: 'Website — continued',
      workspacePath: SERIES_PATH,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    });

    const groups = groupDesignsByWorkspace([continued, source], 'updatedAt');

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Design a');
    expect(groups[0]?.designs.map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('treats case-variant workspace paths as the same series on Windows', () => {
    const original = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    try {
      const a = makeDesign({ id: 'a', workspacePath: SERIES_PATH });
      const b = makeDesign({ id: 'b', workspacePath: SERIES_PATH.toUpperCase() });

      expect(groupDesignsByWorkspace([a, b], 'updatedAt')).toHaveLength(1);
    } finally {
      Object.defineProperty(navigator, 'platform', { value: original, configurable: true });
    }
  });

  it('gives each workspace-less design its own singleton group', () => {
    const a = makeDesign({ id: 'a' });
    const b = makeDesign({ id: 'b' });

    const groups = groupDesignsByWorkspace([a, b], 'updatedAt');

    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
    for (const group of groups) expect(group.designs).toHaveLength(1);
  });

  it('sorts a flat list by the shared sort key for search results', () => {
    const a = makeDesign({ id: 'a', lastSessionAt: null, updatedAt: '2026-09-20T00:00:00.000Z' });
    const b = makeDesign({ id: 'b', lastSessionAt: '2026-09-15T00:00:00.000Z' });

    const sorted = sortDesignsForList([a, b], 'lastSessionAt');

    expect(sorted.map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('breaks equal sort keys by newest createdAt first', () => {
    const older = makeDesign({
      id: 'a',
      lastSessionAt: '2026-09-15T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const newer = makeDesign({
      id: 'b',
      lastSessionAt: '2026-09-15T00:00:00.000Z',
      createdAt: '2026-09-10T00:00:00.000Z',
    });

    expect(sortDesignsForList([older, newer], 'lastSessionAt').map((d) => d.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('sorts by lastSessionAt with nulls sinking within the group', () => {
    const neverChatted = makeDesign({
      id: 'a',
      workspacePath: SERIES_PATH,
      lastSessionAt: null,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    const chatted = makeDesign({
      id: 'b',
      workspacePath: SERIES_PATH,
      lastSessionAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    });

    const groups = groupDesignsByWorkspace([neverChatted, chatted], 'lastSessionAt');

    expect(groups[0]?.designs.map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('orders groups by the strongest sort value of their top design', () => {
    const activeSeries = makeDesign({
      id: 'a',
      workspacePath: SERIES_PATH,
      lastSessionAt: '2026-09-18T00:00:00.000Z',
    });
    const staleSeries = makeDesign({
      id: 'b',
      workspacePath: 'C:/Users/0/Documents/CoDesign/other',
      lastSessionAt: '2026-09-01T00:00:00.000Z',
    });

    const groups = groupDesignsByWorkspace([staleSeries, activeSeries], 'lastSessionAt');

    expect(groups.map((g) => g.designs[0]?.id)).toEqual(['a', 'b']);
  });
});

describe('folderRepresentative', () => {
  it('fronts the top-sorted member with the series name', () => {
    const source = makeDesign({ id: 'a', workspacePath: SERIES_PATH });
    const continued = makeDesign({
      id: 'b',
      name: 'Design a — continued',
      workspacePath: SERIES_PATH,
      updatedAt: '2026-09-10T00:00:00.000Z',
    });
    const [group] = groupDesignsByWorkspace([source, continued], 'updatedAt');

    const rep = group ? folderRepresentative(group.designs, group.title) : undefined;

    expect(rep?.id).toBe('b');
    expect(rep?.name).toBe('Design a');
  });

  it('prefers an actively generating member over the newest one', () => {
    const newest = makeDesign({
      id: 'a',
      workspacePath: SERIES_PATH,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    const working = makeDesign({
      id: 'b',
      workspacePath: SERIES_PATH,
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const [group] = groupDesignsByWorkspace([newest, working], 'updatedAt');

    const rep = group
      ? folderRepresentative(group.designs, group.title, (d) => d.id === 'b')
      : undefined;

    expect(rep?.id).toBe('b');
  });

  it('returns the member untouched when it already carries the series name', () => {
    const solo = makeDesign({ id: 'a', name: 'Solo' });

    const rep = folderRepresentative([solo], 'Solo');

    expect(rep).toBe(solo);
  });
});
