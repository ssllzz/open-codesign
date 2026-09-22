import type { ChatMessageRow } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { buildRenamePrompt } from './rename-ai';

function row(id: number, kind: ChatMessageRow['kind'], payload: unknown, seq = id): ChatMessageRow {
  return {
    schemaVersion: 1,
    id,
    designId: 'design-1',
    seq,
    kind,
    payload,
    snapshotId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('buildRenamePrompt', () => {
  it('includes the current name and conversation excerpts in row order', () => {
    const prompt = buildRenamePrompt({
      currentName: '海信戴氏',
      rows: [
        row(1, 'user', { text: '帮我做一个海信戴氏教育的落地页' }),
        row(2, 'tool_call', { toolName: 'preview' }),
        row(3, 'assistant_text', { text: '已完成首屏与课程模块' }),
        row(4, 'user', { text: '配色改成品牌蓝' }),
      ],
      thumbnailText: null,
    });

    expect(prompt).toContain('Current name: 海信戴氏');
    expect(prompt.indexOf('帮我做一个')).toBeLessThan(prompt.indexOf('已完成首屏'));
    expect(prompt.indexOf('已完成首屏')).toBeLessThan(prompt.indexOf('配色改成品牌蓝'));
    expect(prompt).not.toContain('preview');
  });

  it('falls back to the thumbnail text when the session has no chat rows', () => {
    const prompt = buildRenamePrompt({
      currentName: 'X',
      rows: [row(1, 'tool_call', { toolName: 'bash' })],
      thumbnailText: '海信戴氏 品牌官网 首屏文案',
    });

    expect(prompt).toContain('Current name: X');
    expect(prompt).toContain('Design content preview:');
    expect(prompt).toContain('海信戴氏');
  });

  it('returns an empty string when there is nothing to summarize', () => {
    expect(buildRenamePrompt({ currentName: 'X', rows: [], thumbnailText: null })).toBe('');
    expect(buildRenamePrompt({ currentName: 'X', rows: [], thumbnailText: '   ' })).toBe('');
  });

  it('caps turn counts and keeps the most recent turns', () => {
    const rows: ChatMessageRow[] = [];
    for (let i = 0; i < 15; i++) {
      rows.push(row(i * 2, 'user', { text: `请求 ${i}` }));
      rows.push(row(i * 2 + 1, 'assistant_text', { text: `回复 ${i}` }));
    }

    const prompt = buildRenamePrompt({ currentName: 'X', rows, thumbnailText: null });

    expect((prompt.match(/User:/g) ?? []).length).toBe(10);
    expect((prompt.match(/Assistant:/g) ?? []).length).toBe(6);
    expect(prompt).toContain('请求 14');
    expect(prompt).not.toContain('请求 0');
    expect(prompt).toContain('回复 14');
    expect(prompt).not.toContain('回复 0');
  });

  it('ignores payloads whose text is not a string', () => {
    const prompt = buildRenamePrompt({
      currentName: 'X',
      rows: [
        row(1, 'user', { text: 42 }),
        row(2, 'user', null),
        row(3, 'user', { text: '有效请求' }),
      ],
      thumbnailText: null,
    });

    expect(prompt).toContain('有效请求');
    expect((prompt.match(/User:/g) ?? []).length).toBe(1);
  });

  it('truncates single excerpts and the total budget', () => {
    const longText = '长'.repeat(900);
    const rows: ChatMessageRow[] = [];
    for (let i = 0; i < 15; i++) {
      rows.push(row(i * 2, 'user', { text: longText }));
      rows.push(row(i * 2 + 1, 'assistant_text', { text: longText }));
    }

    const prompt = buildRenamePrompt({ currentName: 'X', rows, thumbnailText: null });

    expect(prompt).toHaveLength(6001); // TOTAL_BUDGET + ellipsis
  });
});
