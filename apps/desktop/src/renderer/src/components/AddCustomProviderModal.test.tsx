import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  AddCustomProviderModal,
  buildKeylessPayload,
  parseModelsInput,
} from './AddCustomProviderModal';

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string) => key,
}));

describe('AddCustomProviderModal', () => {
  it('shows the compatibility warning and keyless opt-in for the add form', () => {
    const html = renderToStaticMarkup(
      <AddCustomProviderModal onSave={() => undefined} onClose={() => undefined} />,
    );

    expect(html).toContain('settings.providers.custom.compatibilityHintTitle');
    expect(html).toContain('settings.providers.custom.compatibilityHintBody');
    expect(html).toContain('settings.providers.custom.allowPrivateNetwork');
    expect(html).toContain('settings.providers.custom.keylessLabel');
    expect(html).toContain('settings.providers.custom.modelsHint');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });

  it('pre-fills the models textarea in edit mode', () => {
    const html = renderToStaticMarkup(
      <AddCustomProviderModal
        onSave={() => undefined}
        onClose={() => undefined}
        editTarget={{
          id: 'volcano',
          name: '火山',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          wire: 'anthropic',
          models: ['kimi-k2.8-preview', 'kimi-k3'],
        }}
      />,
    );

    expect(html).toContain('kimi-k2.8-preview, kimi-k3');
  });

  it('shows the stored key mask as the API key placeholder in edit mode', () => {
    const html = renderToStaticMarkup(
      <AddCustomProviderModal
        onSave={() => undefined}
        onClose={() => undefined}
        editTarget={{
          id: 'volcano',
          name: '火山',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          wire: 'anthropic',
          models: ['kimi-k2.8-preview'],
          keyMask: 'ark-***3d6e',
        }}
      />,
    );

    // The i18n mock returns the key verbatim; asserting the placeholder key
    // proves the mask branch was taken (a missing mask renders 'sk-...').
    expect(html).toContain('settings.providers.custom.apiKeyEditPlaceholder');
  });
});

describe('parseModelsInput', () => {
  it('splits comma / whitespace / newline separated ids and dedupes', () => {
    expect(parseModelsInput('kimi-k2.8-preview, kimi-k3\nglm-5.2  deepseek-v4')).toEqual([
      'kimi-k2.8-preview',
      'kimi-k3',
      'glm-5.2',
      'deepseek-v4',
    ]);
    expect(parseModelsInput('m1, m1, m1')).toEqual(['m1']);
  });

  it('returns an empty list for blank input', () => {
    expect(parseModelsInput('   ')).toEqual([]);
  });
});

describe('buildKeylessPayload', () => {
  it('blanks the key in keyless mode', () => {
    expect(buildKeylessPayload(true, 'sk-stale')).toEqual({ keyless: true, apiKey: '' });
  });

  it('trims the key in keyed mode', () => {
    expect(buildKeylessPayload(false, ' sk-entered ')).toEqual({
      keyless: false,
      apiKey: 'sk-entered',
    });
    expect(buildKeylessPayload(false, '')).toEqual({ keyless: false, apiKey: '' });
  });
});
