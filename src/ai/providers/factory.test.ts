import { describe, it, expect, vi } from 'vitest';
import { getAIModel } from './factory';

// Mock the AI SDK providers
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
  it('should return an OpenAI model by default', () => {
    const model = getAIModel('openai') as any;
    expect(model.provider).toBe('openai');
    expect(model.modelId).toBe('gpt-4o-mini');
  });

  it('should return an Anthropic model', () => {
    const model = getAIModel('anthropic') as any;
    expect(model.provider).toBe('anthropic');
    expect(model.modelId).toBe('claude-3-5-sonnet-20241022');
  });

  it('should return a Google model', () => {
    const model = getAIModel('google') as any;
    expect(model.provider).toBe('google');
    expect(model.modelId).toBe('gemini-1.5-flash');
  });

  it('should handle legacy zaic provider', () => {
    const model = getAIModel('zaic') as any;
    expect(model.provider).toBe('openai'); // Zaic uses OpenAI SDK
    expect(model.modelId).toBe('gpt-4o-mini');
  });

  it('should handle legacy zaic with default model', () => {
    const model = getAIModel('zaic', 'default') as any;
    expect(model.provider).toBe('openai');
    expect(model.modelId).toBe('gpt-4o-mini');
  });

  it('should allow custom model IDs', () => {
    const model = getAIModel('openai', 'gpt-4o') as any;
    expect(model.modelId).toBe('gpt-4o');
  });

  it('should throw for unsupported providers', () => {
    expect(() => getAIModel('unknown')).toThrow();
  });
});
