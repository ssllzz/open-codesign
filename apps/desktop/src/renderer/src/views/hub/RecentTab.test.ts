import type { Design } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { buildRecentDesigns } from './RecentTab';

function design(id: string, updatedAt: string): Design {
  return {
    schemaVersion: 1,
    id,
    name: id,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
    thumbnailText: null,
    workspacePath: null,
  };
}

describe('buildRecentDesigns', () => {
  it('uses update time when no design is actively working', () => {
    const designs = [
      design('recent-1', '2026-05-05T11:00:00.000Z'),
      design('recent-2', '2026-05-05T10:00:00.000Z'),
      design('recent-3', '2026-05-05T09:00:00.000Z'),
      design('old-open-design', '2026-05-01T09:00:00.000Z'),
    ];

    expect(buildRecentDesigns(designs, {}, 3).map((d) => d.id)).toEqual([
      'recent-1',
      'recent-2',
      'recent-3',
    ]);
  });

  it('keeps background working designs visible on the hub', () => {
    const designs = [
      design('recent-1', '2026-05-05T11:00:00.000Z'),
      design('recent-2', '2026-05-05T10:00:00.000Z'),
      design('working-old', '2026-05-01T09:00:00.000Z'),
    ];

    expect(
      buildRecentDesigns(
        designs,
        { 'working-old': { generationId: 'gen-old', stage: 'streaming' } },
        2,
      ).map((d) => d.id),
    ).toEqual(['working-old', 'recent-1']);
  });

  it('shows one card per workspace folder, fronted by the latest session', () => {
    const folder = 'C:/Users/0/Documents/CoDesign/website';
    const source = {
      ...design('source', '2026-05-01T09:00:00.000Z'),
      workspacePath: folder,
      name: 'Website',
    };
    const middle = {
      ...design('middle', '2026-05-03T09:00:00.000Z'),
      workspacePath: folder,
      name: 'Website — continued',
    };
    const latest = {
      ...design('latest', '2026-05-05T09:00:00.000Z'),
      workspacePath: folder,
      name: 'Website — continued (2)',
    };
    const other = design('other-project', '2026-05-04T09:00:00.000Z');

    const result = buildRecentDesigns([source, middle, latest, other], {});

    expect(result.map((d) => d.id)).toEqual(['latest', 'other-project']);
    expect(result[0]?.name).toBe('Website');
  });

  it('lets an actively generating session front its folder', () => {
    const folder = 'C:/Users/0/Documents/CoDesign/website';
    const latest = { ...design('latest', '2026-05-05T09:00:00.000Z'), workspacePath: folder };
    const working = {
      ...design('working', '2026-05-01T09:00:00.000Z'),
      workspacePath: folder,
      name: 'Website — continued',
    };
    const other = design('other-project', '2026-05-04T09:00:00.000Z');

    const result = buildRecentDesigns([latest, working, other], {
      working: { generationId: 'gen-1', stage: 'thinking' },
    });

    expect(result.map((d) => d.id)).toEqual(['working', 'other-project']);
  });
});
