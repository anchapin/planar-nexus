import { describe, it, expect, vi } from 'vitest';
import { getAIModel, isSupportedProvider } from './factory';

// Mock the AI SDK providers. vitest intercepts dynamic `import()` too, so the
// mocked factories are returned even though factory.ts uses `await import(...)`.
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((id) => ({ modelId: id, provider: 'openai' }))),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn((id) => ({ modelId: id, provider: 'anthropic' }))),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn((id) => ({ modelId: id, provider: 'google' }))),
}));

describe('AI Model Factory', () => {
  it('should return an OpenAI model by default', async () => {
    const model = await getAIModel('openai');
    expect((model as any).provider).toBe('openai');
    expect((model as any).modelId).toBe('gpt-4o-mini');
  });

  it('should return an Anthropic model', async () => {
    const model = await getAIModel('anthropic');
    expect((model as any).provider).toBe('anthropic');
    expect((model as any).modelId).toBe('claude-3-5-sonnet-20241022');
  });

  it('should return a Google model', async () => {
    const model = await getAIModel('google');
    expect((model as any).provider).toBe('google');
    expect((model as any).modelId).toBe('gemini-1.5-flash-latest');
  });

  it('should handle legacy zaic provider', async () => {
    const model = await getAIModel('zaic');
    expect((model as any).provider).toBe('openai'); // Zaic uses OpenAI SDK
    expect((model as any).modelId).toBe('gpt-4o-mini');
  });

  it('should handle legacy zaic with default model', async () => {
    const model = await getAIModel('zaic', 'default');
    expect((model as any).provider).toBe('openai');
    expect((model as any).modelId).toBe('gpt-4o-mini');
  });

  it('should allow custom model IDs', async () => {
    const model = await getAIModel('openai', 'gpt-4o');
    expect((model as any).modelId).toBe('gpt-4o');
  });

  it('should throw for unsupported providers', async () => {
    await expect(getAIModel('unknown')).rejects.toThrow();
  });

  it('should lazily import only the requested provider SDK', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');

    await getAIModel('openai');
    expect(createAnthropic).not.toHaveBeenCalled();
    expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
  });
});

describe('isSupportedProvider', () => {
  it('recognizes known providers and aliases', () => {
    expect(isSupportedProvider('openai')).toBe(true);
    expect(isSupportedProvider('anthropic')).toBe(true);
    expect(isSupportedProvider('google')).toBe(true);
    expect(isSupportedProvider('zaic')).toBe(true);
    expect(isSupportedProvider('z-ai')).toBe(true);
    expect(isSupportedProvider('custom')).toBe(true);
  });

  it('rejects unknown providers', () => {
    expect(isSupportedProvider('nope')).toBe(false);
  });
});
