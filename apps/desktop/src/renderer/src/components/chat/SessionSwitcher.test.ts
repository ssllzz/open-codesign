import { initI18n } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { sessionsInWorkspace } from './SessionSwitcher';

const FOLDER = 'C:/Users/0/Documents/CoDesign/hisense-daishi';

function design(id: string, overrides: Partial<Design> = {}): Design {
  return {
    schemaVersion: 1,
    id,
    name: id,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    thumbnailText: null,
    deletedAt: null,
    workspacePath: FOLDER,
    ...overrides,
  };
}

beforeAll(async () => {
  await initI18n('en');
});

describe('sessionsInWorkspace', () => {
  it('lists sibling sessions on the folder, newest first', () => {
    const oldest = design('a', { createdAt: '2026-09-01T00:00:00.000Z' });
    const newest = design('b', { updatedAt: '2026-09-05T00:00:00.000Z' });
    const middle = design('c', { updatedAt: '2026-09-03T00:00:00.000Z' });
    const elsewhere = design('elsewhere', {
      workspacePath: 'C:/Users/0/Documents/CoDesign/other',
    });

    const sessions = sessionsInWorkspace([oldest, newest, middle, elsewhere], 'a');

    expect(sessions.map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });

  it('excludes deleted sessions and designs without a workspace folder', () => {
    const current = design('a');
    const deleted = design('gone', { deletedAt: '2026-09-02T00:00:00.000Z' });
    const unbound = design('unbound', { workspacePath: null });

    const sessions = sessionsInWorkspace([current, deleted, unbound], 'a');

    expect(sessions.map((d) => d.id)).toEqual(['a']);
  });

  it('returns only the current design when it has no workspace folder', () => {
    const solo = design('solo', { workspacePath: null });

    expect(sessionsInWorkspace([solo], 'solo').map((d) => d.id)).toEqual(['solo']);
  });

  it('returns nothing when the current design is unknown', () => {
    expect(sessionsInWorkspace([design('a')], 'missing')).toEqual([]);
  });
});
