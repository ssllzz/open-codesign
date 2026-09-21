import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DesignSessionBriefV1 } from '@open-codesign/core';
import type { Design } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendSessionDesignBrief,
  appendSessionRunPreferences,
  readSessionDesignBrief,
  readSessionRunPreferences,
} from './session-chat';
import {
  createDesign,
  initSnapshotsDb,
  listSnapshots,
  updateDesignWorkspace,
} from './snapshots-db';
import { registerSnapshotsIpc } from './snapshots-ipc';
import { normalizeWorkspacePath } from './workspace-path';

type Handler = (event: unknown, raw: unknown) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock('./electron-runtime', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler;
}

function makeBrief(designId: string, designName: string): DesignSessionBriefV1 {
  return {
    schemaVersion: 1,
    designId,
    designName,
    updatedAt: '2026-09-20T00:00:00.000Z',
    goal: 'Marketing site for a design tool',
    artifactType: 'react',
    audience: 'Product designers',
    visualDirection: 'editorial, warm neutrals',
    stableDecisions: ['Inter for headings', '8pt spacing grid'],
    userPreferences: ['avoid carousels'],
    dislikes: ['drop shadows on text'],
    openTasks: ['pricing page copy'],
    currentFiles: ['App.jsx', 'DESIGN.md'],
    lastVerification: { status: 'ok', checkedAt: '2026-09-19T00:00:00.000Z' },
    lastUserIntent: 'deepen the pricing section',
  };
}

describe('snapshots:v1:continue-design', () => {
  let root: string;
  let db: ReturnType<typeof initSnapshotsDb>;
  let source: Design;
  let sourceWorkspace: string;

  beforeEach(async () => {
    handlers.clear();
    root = await mkdtemp(path.join(os.tmpdir(), 'codesign-continue-design-'));
    db = initSnapshotsDb(path.join(root, 'design-store.json'));
    sourceWorkspace = normalizeWorkspacePath(path.join(root, 'website'));
    await mkdir(sourceWorkspace, { recursive: true });
    source = createDesign(db, 'Website');
    updateDesignWorkspace(db, source.id, sourceWorkspace, 'blank-canvas');
    registerSnapshotsIpc(db);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function call(designId: string, name = 'Website continued'): Promise<Design> {
    const handler = getHandler('snapshots:v1:continue-design');
    return handler(null, { schemaVersion: 1, id: designId, name }) as Promise<Design>;
  }

  it('creates a new design sharing the source workspace with inherited memory', async () => {
    const opts = { db, sessionDir: db.sessionDir };
    const brief = makeBrief(source.id, source.name);
    appendSessionDesignBrief(opts, source.id, brief);
    appendSessionRunPreferences(opts, source.id, {
      schemaVersion: 1,
      tweaks: 'yes',
      bitmapAssets: 'auto',
      reusableSystem: 'no',
    });

    const continued = await call(source.id);

    expect(continued.workspacePath).toBe(sourceWorkspace);
    expect(continued.workspaceMode).toBe('work-on-project');
    expect(continued.name).toBe('Website continued');
    expect(continued.id).not.toBe(source.id);

    const inheritedBrief = readSessionDesignBrief(opts, continued.id);
    expect(inheritedBrief).toEqual({
      ...brief,
      designId: continued.id,
      designName: 'Website continued',
      updatedAt: inheritedBrief?.updatedAt,
    });
    expect(inheritedBrief?.updatedAt).not.toBe(brief.updatedAt);
    const inheritedPreferences = readSessionRunPreferences(opts, continued.id);
    expect(inheritedPreferences?.tweaks).toBe('yes');
    expect(inheritedPreferences?.bitmapAssets).toBe('auto');

    expect(listSnapshots(db, continued.id)).toHaveLength(0);
  });

  it('supports chaining continuations on the same shared workspace', async () => {
    const opts = { db, sessionDir: db.sessionDir };
    appendSessionDesignBrief(opts, source.id, makeBrief(source.id, source.name));

    const second = await call(source.id);
    const third = await call(second.id, 'Website continued again');

    expect(second.workspacePath).toBe(sourceWorkspace);
    expect(third.workspacePath).toBe(sourceWorkspace);
    const thirdBrief = readSessionDesignBrief(opts, third.id);
    expect(thirdBrief?.goal).toBe('Marketing site for a design tool');
    expect(thirdBrief?.designId).toBe(third.id);
    expect(thirdBrief?.designName).toBe('Website continued again');
  });

  it('succeeds without inherited memory when the source session has none', async () => {
    const opts = { db, sessionDir: db.sessionDir };
    const continued = await call(source.id);

    expect(continued.workspacePath).toBe(sourceWorkspace);
    expect(readSessionDesignBrief(opts, continued.id)).toBeNull();
    expect(readSessionRunPreferences(opts, continued.id)).toBeNull();
  });

  it('rejects when the source design does not exist', async () => {
    await expect(call('missing-id')).rejects.toMatchObject({
      code: 'IPC_NOT_FOUND',
    });
  });

  it('rejects when the source design has no workspace bound', async () => {
    const unbound = createDesign(db, 'Unbound');
    await expect(call(unbound.id)).rejects.toMatchObject({
      code: 'IPC_BAD_INPUT',
    });
  });
});
