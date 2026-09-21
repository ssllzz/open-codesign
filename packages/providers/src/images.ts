import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

export type ImageGenerationProvider = 'openai' | 'openrouter';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
export type ImageSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface GenerateImageOptions {
  provider: ImageGenerationProvider;
  apiKey: string;
  prompt: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
  size?: ImageSize | undefined;
  aspectRatio?: ImageAspectRatio | undefined;
  quality?: ImageQuality | undefined;
  outputFormat?: ImageOutputFormat | undefined;
  background?: 'auto' | 'transparent' | 'opaque' | undefined;
  signal?: AbortSignal | undefined;
  httpHeaders?: Record<string, string> | undefined;
}

export interface GenerateImageResult {
  dataUrl: string;
  mimeType: string;
  base64: string;
  model: string;
  provider: ImageGenerationProvider;
  revisedPrompt?: string | undefined;
}

type ResolvedImageOptions = GenerateImageOptions & { model: string };

interface ImageRequestPlan {
  path: string;
  body: Record<string, unknown>;
}

interface ImageResponseData {
  dataUrl: string;
  mimeType: string;
  base64: string;
  revisedPrompt?: string | undefined;
}

interface ImageProviderStrategy {
  readonly defaultModel: string;
  readonly defaultBaseUrl: string;
  buildRequest(prompt: string, options: ResolvedImageOptions): ImageRequestPlan;
  parseResponse(json: unknown, options: ResolvedImageOptions): ImageResponseData;
}

interface ImageGenerationsResponse {
  data?: Array<{
    b64_json?: unknown;
    url?: unknown;
    revised_prompt?: unknown;
  }>;
}

interface OpenRouterImageResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      images?: Array<{
        type?: unknown;
        image_url?: {
          url?: unknown;
        };
        imageUrl?: {
          url?: unknown;
        };
      }>;
    };
  }>;
}

function buildOpenAIRequest(prompt: string, options: ResolvedImageOptions): ImageRequestPlan {
  const body: Record<string, unknown> = {
    model: options.model,
    prompt,
    n: 1,
  };
  if (options.size !== undefined) body['size'] = options.size;
  if (options.quality !== undefined) body['quality'] = options.quality;
  if (options.outputFormat !== undefined) body['output_format'] = options.outputFormat;
  if (options.background !== undefined) body['background'] = options.background;
  return { path: 'images/generations', body };
}

function parseOpenAIResponse(json: unknown, options: ResolvedImageOptions): ImageResponseData {
  const first = (json as ImageGenerationsResponse).data?.[0];
  if (first === undefined) {
    throw new CodesignError(
      'OpenAI image response did not include data',
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  const revisedPrompt =
    typeof first.revised_prompt === 'string' && first.revised_prompt.length > 0
      ? first.revised_prompt
      : undefined;
  if (typeof first.b64_json === 'string' && first.b64_json.length > 0) {
    const mimeType = mimeFromFormat(options.outputFormat ?? 'png');
    const base64 = normalizeBase64ImageData(first.b64_json, 'OpenAI image response');
    validateImageSignature(mimeType, base64, 'OpenAI image response');
    return withOptionalRevisedPrompt(
      { dataUrl: `data:${mimeType};base64,${base64}`, mimeType, base64 },
      revisedPrompt,
    );
  }
  if (typeof first.url === 'string' && first.url.trim().startsWith('data:')) {
    return withOptionalRevisedPrompt(parseDataUrl(first.url), revisedPrompt);
  }
  throw new CodesignError(
    'OpenAI image response did not include base64 image data',
    ERROR_CODES.PROVIDER_ERROR,
  );
}

function buildOpenRouterRequest(prompt: string, options: ResolvedImageOptions): ImageRequestPlan {
  const imageConfig: Record<string, unknown> = {};
  if (options.aspectRatio !== undefined) imageConfig['aspect_ratio'] = options.aspectRatio;
  if (options.quality !== undefined && options.quality !== 'auto')
    imageConfig['quality'] = options.quality;
  if (options.outputFormat !== undefined) imageConfig['output_format'] = options.outputFormat;

  const body: Record<string, unknown> = {
    model: options.model,
    messages: [{ role: 'user', content: prompt }],
    modalities: ['image', 'text'],
    stream: false,
  };
  if (Object.keys(imageConfig).length > 0) body['image_config'] = imageConfig;
  return { path: 'chat/completions', body };
}

function parseOpenRouterResponse(json: unknown): ImageResponseData {
  const message = (json as OpenRouterImageResponse).choices?.[0]?.message;
  const image = message?.images?.[0];
  const url = image?.image_url?.url ?? image?.imageUrl?.url;
  if (typeof url === 'string' && url.trim().startsWith('data:')) {
    return parseDataUrl(url);
  }
  throw new CodesignError(
    'OpenRouter image response did not include generated image data',
    ERROR_CODES.PROVIDER_ERROR,
  );
}

const STRATEGIES: Record<ImageGenerationProvider, ImageProviderStrategy> = {
  openai: {
    defaultModel: 'gpt-image-2',
    defaultBaseUrl: 'https://api.openai.com/v1',
    buildRequest: buildOpenAIRequest,
    parseResponse: parseOpenAIResponse,
  },
  openrouter: {
    defaultModel: 'openai/gpt-5.4-image-2',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    buildRequest: buildOpenRouterRequest,
    parseResponse: (json) => parseOpenRouterResponse(json),
  },
};

export function defaultImageModel(provider: ImageGenerationProvider): string {
  return STRATEGIES[provider].defaultModel;
}

export function defaultImageBaseUrl(provider: ImageGenerationProvider): string {
  return STRATEGIES[provider].defaultBaseUrl;
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  if (!options.apiKey.trim()) {
    throw new CodesignError('Missing image generation API key', ERROR_CODES.PROVIDER_AUTH_MISSING);
  }
  const prompt = options.prompt.trim();
  if (prompt.length === 0) {
    throw new CodesignError('Image prompt cannot be empty', ERROR_CODES.INPUT_EMPTY_PROMPT);
  }
  const strategy = STRATEGIES[options.provider];
  const resolved: ResolvedImageOptions = {
    ...options,
    prompt,
    model: options.model?.trim() || strategy.defaultModel,
  };
  const { path, body } = strategy.buildRequest(prompt, resolved);
  const json = await postJson<unknown>(
    joinEndpoint(resolved.baseUrl ?? strategy.defaultBaseUrl, path),
    body,
    options,
  );
  return {
    ...strategy.parseResponse(json, resolved),
    model: resolved.model,
    provider: options.provider,
  };
}

function withOptionalRevisedPrompt(
  data: ImageResponseData,
  revisedPrompt: string | undefined,
): ImageResponseData {
  return revisedPrompt === undefined ? data : { ...data, revisedPrompt };
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  options: GenerateImageOptions,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(options.httpHeaders ?? {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CodesignError(
      `Image generation request failed: ${message}`,
      ERROR_CODES.PROVIDER_ERROR,
      {
        cause: err,
      },
    );
  }
  if (!res.ok) {
    const text = await safeResponseText(res);
    throw new CodesignError(
      `Image generation failed with HTTP ${res.status}${text.length > 0 ? `: ${text}` : ''}`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CodesignError(
      `Image generation response was not valid JSON: ${message}`,
      ERROR_CODES.PROVIDER_ERROR,
      { cause: err },
    );
  }
}

function joinEndpoint(baseUrl: string, path: string): string {
  // Trim trailing `/` on baseUrl and leading `/` on path with explicit loops
  // instead of /\/+$/ + /^\/+/. CodeQL flags the anchored-quantifier regex
  // form as polynomial ReDoS on library input, and a simple scan is both
  // linear in the worst case and easier to reason about.
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  let start = 0;
  while (start < path.length && path.charCodeAt(start) === 47) start++;
  return `${baseUrl.slice(0, end)}/${path.slice(start)}`;
}

function mimeFromFormat(format: ImageOutputFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function parseDataUrl(dataUrl: string): { dataUrl: string; mimeType: string; base64: string } {
  const trimmedDataUrl = dataUrl.trim();
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(trimmedDataUrl);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new CodesignError('Generated image data URL is malformed', ERROR_CODES.PROVIDER_ERROR);
  }
  const base64 = normalizeBase64ImageData(match[2], 'Generated image data URL');
  validateImageSignature(match[1], base64, 'Generated image data URL');
  return { dataUrl: `data:${match[1]};base64,${base64}`, mimeType: match[1], base64 };
}

const BASE64_IMAGE_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function normalizeBase64ImageData(base64: string, source: string): string {
  const trimmed = base64.trim();
  if (trimmed.length === 0 || trimmed.length % 4 === 1 || !BASE64_IMAGE_RE.test(trimmed)) {
    throw new CodesignError(
      `${source} included malformed base64 image data`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  return trimmed;
}

type ImageSignatureMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

function detectImageSignature(bytes: Buffer): ImageSignatureMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function validateImageSignature(mimeType: string, base64: string, source: string): void {
  const normalizedMime = mimeType.toLowerCase();
  if (!normalizedMime.startsWith('image/')) {
    throw new CodesignError(`${source} was not an image MIME type`, ERROR_CODES.PROVIDER_ERROR);
  }
  if (
    normalizedMime !== 'image/png' &&
    normalizedMime !== 'image/jpeg' &&
    normalizedMime !== 'image/jpg' &&
    normalizedMime !== 'image/webp'
  ) {
    throw new CodesignError(
      `${source} used unsupported image MIME type ${normalizedMime}`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  const detected = detectImageSignature(Buffer.from(base64, 'base64'));
  const canonical = normalizedMime === 'image/jpg' ? 'image/jpeg' : normalizedMime;
  if (detected !== canonical) {
    throw new CodesignError(
      `${source} bytes did not match ${normalizedMime}`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
}

async function safeResponseText(res: Response, limit = 500): Promise<string> {
  try {
    const text = await res.text();
    return Number.isFinite(limit) ? text.slice(0, limit) : text;
  } catch (err) {
    void err;
    // The non-2xx HTTP status is already the failure; the body is diagnostic.
    return '';
  }
}
