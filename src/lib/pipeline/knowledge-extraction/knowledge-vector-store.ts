import {
  create,
  type AnyOrama,
  insert,
  insertMultiple,
  search as oramaSearch,
} from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { db } from "../../db/local-intelligence-db";
import type {
  HeuristicCategory,
  HeuristicDocument,
  HeuristicRecord,
  KnowledgeSearchQuery,
  KnowledgeSearchResult,
  KnowledgeStats,
} from "./types";
import { HEURISTIC_CATEGORIES } from "./types";

const EMBEDDING_DIM = 384;

const ZERO_VECTOR = new Array(EMBEDDING_DIM).fill(0);

function recordToDocument(record: HeuristicRecord): HeuristicDocument {
  return {
    id: record.id,
    category: record.category,
    title: record.title,
    description: record.description,
    action: record.action,
    reasoning: record.reasoning,
    confidence: record.confidence,
    frequency: record.frequency,
    archetype: record.archetype || "",
    format: record.format || "",
    tags: record.tags,
    vector: ZERO_VECTOR,
  };
}

function buildEmbeddingText(record: HeuristicRecord): string {
  const parts: string[] = [
    record.title,
    record.description,
    record.action,
    record.reasoning,
    record.category,
    ...(record.tags || []),
  ];

  if (record.archetype) parts.push(record.archetype);
  if (record.game_state_signature) parts.push(record.game_state_signature);

  return parts.join(" ");
}

function generateDeterministicEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
  }
  let rng = Math.abs(seed) || 1;
  const next = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const n = Math.min(words.length, 100);

  for (let i = 0; i < n; i++) {
    const wordHash = (() => {
      let h = 0;
      for (let j = 0; j < words[i].length; j++) {
        h = ((h << 5) - h + words[i].charCodeAt(j)) | 0;
      }
      return Math.abs(h);
    })();

    const startDim = wordHash % EMBEDDING_DIM;
    const span = 3 + (wordHash % 5);
    const magnitude = 0.5 + next() * 0.3;

    for (let d = startDim; d < Math.min(startDim + span, EMBEDDING_DIM); d++) {
      vector[d] += magnitude * (0.7 + next() * 0.3);
    }
  }

  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

export class KnowledgeVectorStore {
  private orama: AnyOrama | null = null;
  private embeddingCache = new Map<string, number[]>();
  private recordStore = new Map<string, HeuristicRecord>();

  async init(): Promise<void> {
    if (this.orama) return;

    const loaded = await this.loadIndex();
    if (loaded) return;

    this.orama = await create({
      schema: {
        id: "string",
        category: "string",
        title: "string",
        description: "string",
        action: "string",
        reasoning: "string",
        confidence: "number",
        frequency: "number",
        archetype: "string",
        format: "string",
        tags: "string",
        vector: `vector[${EMBEDDING_DIM}]`,
      } as const,
    });
  }

  private async loadIndex(): Promise<boolean> {
    try {
      const snapshot = await db.orama_snapshots.get("knowledge_heuristics");
      if (snapshot) {
        this.orama = await restore("json", snapshot.data);
        return true;
      }
    } catch (error) {
      console.error("Failed to load knowledge index:", error);
    }
    return false;
  }

  async saveIndex(): Promise<void> {
    if (!this.orama) return;

    try {
      const data = await persist(this.orama, "json");
      await db.orama_snapshots.put({
        id: "knowledge_heuristics",
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Failed to save knowledge index:", error);
    }
  }

  async getOrama(): Promise<AnyOrama> {
    if (!this.orama) {
      await this.init();
    }
    return this.orama!;
  }

  private getEmbedding(text: string): number[] {
    const cached = this.embeddingCache.get(text);
    if (cached) return cached;

    const embedding = generateDeterministicEmbedding(text);
    this.embeddingCache.set(text, embedding);
    return embedding;
  }

  async addRecord(record: HeuristicRecord): Promise<void> {
    const orama = await this.getOrama();
    this.recordStore.set(record.id, record);

    const text = buildEmbeddingText(record);
    const vector = this.getEmbedding(text);

    const doc: HeuristicDocument = {
      ...recordToDocument(record),
      vector,
    };

    await insert(orama, doc);
  }

  async addRecords(records: HeuristicRecord[]): Promise<void> {
    const orama = await this.getOrama();

    for (const record of records) {
      this.recordStore.set(record.id, record);
    }

    const documents: HeuristicDocument[] = records.map((record) => {
      const text = buildEmbeddingText(record);
      const vector = this.getEmbedding(text);
      return { ...recordToDocument(record), vector };
    });

    await insertMultiple(orama, documents);
  }

  async search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult[]> {
    const orama = await this.getOrama();

    const searchOptions: Record<string, unknown> = {
      limit: query.limit ?? 20,
      offset: 0,
    };

    const whereConditions: Record<string, unknown>[] = [];

    if (query.category) {
      whereConditions.push({ category: query.category });
    }
    if (query.archetype) {
      whereConditions.push({ archetype: query.archetype });
    }
    if (query.format) {
      whereConditions.push({ format: query.format });
    }
    if (query.min_confidence !== undefined) {
      whereConditions.push({ confidence: { gte: query.min_confidence } });
    }
    if (query.min_frequency !== undefined) {
      whereConditions.push({ frequency: { gte: query.min_frequency } });
    }

    if (whereConditions.length > 0) {
      searchOptions.where =
        whereConditions.length === 1
          ? whereConditions[0]
          : { AND: whereConditions };
    }

    if (query.vector) {
      searchOptions.vector = {
        value: query.vector,
        property: "vector",
        similarity: query.similarity ?? 0.7,
      };

      if (query.term) {
        searchOptions.mode = "hybrid";
        searchOptions.term = query.term;
      } else {
        searchOptions.mode = "vector";
      }
    } else if (query.term) {
      searchOptions.term = query.term;
      searchOptions.mode = "fulltext";
    }

    const results = await oramaSearch(orama, searchOptions);

    return (results.hits || []).map((hit: any) => {
      const record = this.recordStore.get(hit.id);
      const doc = hit.document as HeuristicDocument;
      return {
        record: record || {
          id: doc.id,
          category: doc.category as HeuristicCategory,
          title: doc.title,
          description: doc.description,
          game_state_signature: "",
          state_hash: "",
          action: doc.action,
          reasoning: doc.reasoning,
          confidence: doc.confidence,
          frequency: doc.frequency,
          archetype: doc.archetype,
          format: doc.format,
          tags: doc.tags,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        score: hit.score ?? hit.similarity ?? 0,
      };
    });
  }

  async searchByGameState(
    stateSignature: string,
    options?: {
      limit?: number;
      category?: HeuristicCategory;
      similarity?: number;
    },
  ): Promise<KnowledgeSearchResult[]> {
    const vector = this.getEmbedding(stateSignature);
    return this.search({
      vector,
      limit: options?.limit ?? 10,
      category: options?.category,
      similarity: options?.similarity ?? 0.6,
    });
  }

  async searchByTerm(
    term: string,
    options?: {
      limit?: number;
      category?: HeuristicCategory;
      archetype?: string;
    },
  ): Promise<KnowledgeSearchResult[]> {
    const vector = this.getEmbedding(term);
    return this.search({
      term,
      vector,
      limit: options?.limit ?? 10,
      category: options?.category,
      archetype: options?.archetype,
    });
  }

  async findSimilar(
    recordId: string,
    options?: { limit?: number; minSimilarity?: number },
  ): Promise<KnowledgeSearchResult[]> {
    const record = this.recordStore.get(recordId);
    if (!record) return [];

    const text = buildEmbeddingText(record);
    const vector = this.getEmbedding(text);

    const allResults = await this.search({ vector, limit: 100, similarity: 0 });

    return allResults
      .filter((r) => r.record.id !== recordId)
      .filter((r) => (r.score ?? 0) >= (options?.minSimilarity ?? 0.5))
      .slice(0, options?.limit ?? 10);
  }

  getRecord(id: string): HeuristicRecord | undefined {
    return this.recordStore.get(id);
  }

  getAllRecords(): HeuristicRecord[] {
    return Array.from(this.recordStore.values());
  }

  getStats(): KnowledgeStats {
    const records = this.getAllRecords();
    const byCategory = {} as Record<HeuristicCategory, number>;

    for (const cat of HEURISTIC_CATEGORIES) {
      byCategory[cat] = 0;
    }

    let totalConfidence = 0;
    let recordsWithEmbeddings = 0;

    for (const record of records) {
      byCategory[record.category] = (byCategory[record.category] || 0) + 1;
      totalConfidence += record.confidence;
      recordsWithEmbeddings++;
    }

    return {
      total_records: records.length,
      by_category: byCategory,
      avg_confidence: records.length > 0 ? totalConfidence / records.length : 0,
      records_with_embeddings: recordsWithEmbeddings,
      last_updated:
        records.length > 0
          ? Math.max(...records.map((r) => r.updated_at))
          : null,
    };
  }

  async clear(): Promise<void> {
    this.orama = null;
    this.recordStore.clear();
    this.embeddingCache.clear();
    await this.init();
  }

  getRecordCount(): number {
    return this.recordStore.size;
  }
}

export const knowledgeVectorStore = new KnowledgeVectorStore();
