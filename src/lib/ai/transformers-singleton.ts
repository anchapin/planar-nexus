import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Configure environment for browser use
env.allowLocalModels = false;
// Note: env.useBrowserCache is deprecated/handled differently in v3, 
// but we'll stick to standard pipeline options where possible.

export class PipelineSingleton {
  static task = 'feature-extraction' as const;
  static model = 'Xenova/all-MiniLM-L6-v2';
  static instance: FeatureExtractionPipeline | null = null;

  static async getInstance(progress_callback?: (progress: any) => void): Promise<FeatureExtractionPipeline> {
    if (this.instance === null) {
      try {
        console.info(`Initializing Transformers.js with model: ${this.model} (WebGPU)`);
        this.instance = (await pipeline(this.task, this.model, {
          progress_callback,
          device: 'webgpu',
        })) as FeatureExtractionPipeline;
      } catch (e) {
        console.warn('WebGPU initialization failed, falling back to WASM/CPU:', e);
        try {
          this.instance = (await pipeline(this.task, this.model, {
            progress_callback,
            device: 'wasm',
          })) as FeatureExtractionPipeline;
        } catch (wasmError) {
          console.error('WASM initialization failed as well:', wasmError);
          throw wasmError;
        }
      }
    }
    return this.instance;
  }
}
