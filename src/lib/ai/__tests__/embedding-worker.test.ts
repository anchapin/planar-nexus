/**
 * @jest-environment node
 */
import { PipelineSingleton } from '../transformers-singleton';
import { testCards } from '../../__fixtures__/test-cards';

// Mock the Transformers.js PipelineSingleton
jest.mock('../transformers-singleton', () => ({
  PipelineSingleton: {
    getInstance: jest.fn(),
  },
}));

// Mock the global self.onmessage and self.postMessage
const mockPostMessage = jest.fn();
let onMessageHandler: (event: any) => Promise<void>;

describe('EmbeddingWorker', () => {
  beforeAll(async () => {
    // Define self BEFORE loading worker
    // @ts-expect-error self mock in Node env
    global.self = {
      postMessage: mockPostMessage,
    };

    // Load the worker to attach the handler
    await import('../embedding-worker');

    // Capture the handler
    onMessageHandler = (global.self as any).onmessage;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should load the model correctly', async () => {
    (PipelineSingleton.getInstance as jest.Mock).mockResolvedValue(jest.fn());

    await onMessageHandler({ data: { type: 'LOAD_MODEL' } });

    expect(PipelineSingleton.getInstance).toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalledWith({ type: 'MODEL_LOADED' });
  });

  it('should generate embeddings for cards', async () => {
    const mockExtractor = jest.fn().mockResolvedValue({
      tolist: () => testCards.map(() => new Array(384).fill(0.5)),
    });
    (PipelineSingleton.getInstance as jest.Mock).mockResolvedValue(mockExtractor);

    const cardsToProcess = testCards.slice(0, 5);
    await onMessageHandler({ 
      data: { type: 'GENERATE_EMBEDDINGS', cards: cardsToProcess } 
    });

    expect(mockExtractor).toHaveBeenCalled();
    
    // Should post progress messages
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PROGRESS' })
    );

    // Should post the final results
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ 
        type: 'EMBEDDINGS_GENERATED',
        results: expect.arrayContaining([
          expect.objectContaining({ 
            id: cardsToProcess[0].id,
            embedding: expect.any(Array)
          })
        ])
      })
    );
  });

  it('should handle errors gracefully', async () => {
    const errorMsg = 'Failed to load model';
    (PipelineSingleton.getInstance as jest.Mock).mockRejectedValue(new Error(errorMsg));

    await onMessageHandler({ data: { type: 'LOAD_MODEL' } });

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'ERROR',
      error: errorMsg
    });
  });
});
