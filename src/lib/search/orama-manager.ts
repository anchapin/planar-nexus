import { create, type AnyOrama } from '@orama/orama';

export interface CardDocument {
  id: string;
  name: string;
  text: string;
  type: string;
  color: string;
  vector: number[];
}

export class OramaManager {
  protected orama: AnyOrama | null = null;

  async init() {
    if (this.orama) return;

    this.orama = await create({
      schema: {
        id: 'string',
        name: 'string',
        text: 'string',
        type: 'string',
        color: 'string',
        vector: 'vector[384]',
      } as const,
    });
  }

  /**
   * Returns the underlying Orama instance.
   * Initializes it if it hasn't been already.
   */
  async getOrama(): Promise<AnyOrama> {
    if (!this.orama) {
      await this.init();
    }
    return this.orama!;
  }
}

export const oramaManager = new OramaManager();
