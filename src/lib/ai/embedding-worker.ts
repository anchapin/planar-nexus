import { PipelineSingleton } from './transformers-singleton';
import { formatCardForEmbedding } from './card-text-processor';
import { MinimalCard } from '../card-database';

// Message types for communication between worker and client
export type WorkerMessage = 
  | { type: 'GENERATE_EMBEDDINGS'; cards: MinimalCard[] }
  | { type: 'LOAD_MODEL' };

export type WorkerResponse = 
  | { type: 'EMBEDDINGS_GENERATED'; results: Array<{ id: string; embedding: number[] }> }
  | { type: 'PROGRESS'; message: string; progress?: number }
  | { type: 'MODEL_LOADED' }
  | { type: 'ERROR'; error: string };

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type } = event.data;

  try {
    if (type === 'LOAD_MODEL') {
      await PipelineSingleton.getInstance((progress) => {
        if (progress.status === 'progress') {
          self.postMessage({ 
            type: 'PROGRESS', 
            message: `Loading model: ${progress.file}`, 
            progress: progress.progress 
          });
        }
      });
      self.postMessage({ type: 'MODEL_LOADED' });
    } 
    
    else if (type === 'GENERATE_EMBEDDINGS') {
      const { cards } = event.data;
      const extractor = await PipelineSingleton.getInstance();
      
      const results: Array<{ id: string; embedding: number[] }> = [];
      
      // Process in small internal batches for memory management
      const internalBatchSize = 10;
      for (let i = 0; i < cards.length; i += internalBatchSize) {
        const currentBatch = cards.slice(i, i + internalBatchSize);
        const texts = currentBatch.map(card => formatCardForEmbedding(card));
        
        self.postMessage({ 
          type: 'PROGRESS', 
          message: `Generating embeddings: ${i} / ${cards.length}`, 
          progress: (i / cards.length) * 100 
        });

        const output = await extractor(texts, {
          pooling: 'mean',
          normalize: true,
        });

        // Convert Tensor to array
        const embeddingsArray = output.tolist() as number[][];
        
        currentBatch.forEach((card, idx) => {
          results.push({
            id: card.id,
            embedding: embeddingsArray[idx]
          });
        });
      }

      self.postMessage({ type: 'EMBEDDINGS_GENERATED', results });
    }
  } catch (error) {
    console.error('Worker error:', error);
    self.postMessage({ 
      type: 'ERROR', 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
};
