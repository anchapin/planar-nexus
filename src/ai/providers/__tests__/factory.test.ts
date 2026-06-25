import { getAIModel, PROVIDER_DEFAULT_MODELS, isSupportedProvider } from '../factory';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(),
}));

jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn(),
}));

jest.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: jest.fn(),
}));

describe('getAIModel', () => {
  const mockModel = { modelId: 'mock-model' };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock implementations
    (createOpenAI as jest.Mock).mockReturnValue(jest.fn().mockReturnValue(mockModel));
    (createAnthropic as jest.Mock).mockReturnValue(jest.fn().mockReturnValue(mockModel));
    (createGoogleGenerativeAI as jest.Mock).mockReturnValue(jest.fn().mockReturnValue(mockModel));

    // Set dummy env vars
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';
  });

  it('should return an OpenAI model when provider is "openai"', async () => {
    const result = await getAIModel('openai');
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'test-openai-key' });
    expect(result).toBe(mockModel);
  });

  it('should use the default model for OpenAI if modelId is not provided', async () => {
    const mockOpenAI = jest.fn().mockReturnValue(mockModel);
    (createOpenAI as jest.Mock).mockReturnValue(mockOpenAI);

    await getAIModel('openai');
    expect(mockOpenAI).toHaveBeenCalledWith(PROVIDER_DEFAULT_MODELS.openai);
  });

  it('should use the provided modelId', async () => {
    const mockOpenAI = jest.fn().mockReturnValue(mockModel);
    (createOpenAI as jest.Mock).mockReturnValue(mockOpenAI);

    const customModel = 'gpt-4-turbo';
    await getAIModel('openai', customModel);
    expect(mockOpenAI).toHaveBeenCalledWith(customModel);
  });

  it('should return an Anthropic model when provider is "anthropic"', async () => {
    const result = await getAIModel('anthropic');
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'test-anthropic-key' });
    expect(result).toBe(mockModel);
  });

  it('should return a Google model when provider is "google"', async () => {
    const result = await getAIModel('google');
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'test-google-key' });
    expect(result).toBe(mockModel);
  });

  it('should throw an error for unsupported providers', async () => {
    await expect(getAIModel('unsupported')).rejects.toThrow(
      'Unsupported provider or no default model for: unsupported',
    );
  });

  it('should lazily import the SDK only for the requested provider', async () => {
    await getAIModel('openai');
    expect(createOpenAI).toHaveBeenCalled();
    // Anthropic / Google SDKs must NOT be loaded for an OpenAI request
    expect(createAnthropic).not.toHaveBeenCalled();
    expect(createGoogleGenerativeAI).not.toHaveBeenCalled();
  });
});

describe('isSupportedProvider', () => {
  it('recognizes known providers', () => {
    expect(isSupportedProvider('openai')).toBe(true);
    expect(isSupportedProvider('anthropic')).toBe(true);
    expect(isSupportedProvider('google')).toBe(true);
    expect(isSupportedProvider('zaic')).toBe(true);
    expect(isSupportedProvider('custom')).toBe(true);
  });

  it('recognizes legacy aliases', () => {
    expect(isSupportedProvider('z-ai')).toBe(true);
  });

  it('rejects unknown providers', () => {
    expect(isSupportedProvider('unsupported')).toBe(false);
  });
});
