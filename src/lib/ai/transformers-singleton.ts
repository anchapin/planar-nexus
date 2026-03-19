import { pipeline, env } from '@huggingface/transformers';

// Configure environment for browser use
env.allowLocalModels = false;
// Note: env.useBrowserCache is deprecated/handled differently in v3, 
// but we'll stick to standard pipeline options where possible.

export class PipelineSingleton {
  static task = 'feature-extraction' as const;
  static model = 'Xenova/all-MiniLM-L6-v2';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static instance: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static async getInstance(progress_callback?: (progress: any) => void): Promise<any> {
    if (this.instance === null) {
      try {
        console.info(`Initializing Transformers.js with model: ${this.model} (WebGPU)`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.instance = await pipeline(this.task as any, this.model, {
          progress_callback,
          device: 'webgpu',
        });
      } catch (e) {
        console.warn('WebGPU initialization failed, falling back to WASM/CPU:', e);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.instance = await pipeline(this.task as any, this.model, {
            progress_callback,
            device: 'wasm',
          });
        } catch (wasmError) {
          console.error('WASM initialization failed as well:', wasmError);
          throw wasmError;
        }
      }
    }
    return this.instance;
  }
}
