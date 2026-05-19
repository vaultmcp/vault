export interface CorpusItem {
  id: string;
  category: string;
  severity: 'low' | 'medium' | 'high';
}

export interface CorpusMeta {
  dim: number;
  count: number;
  model: string;
  items: CorpusItem[];
}

export interface LoadedCorpus {
  meta: CorpusMeta;
  embeddings: Float32Array;
}

export function loadCorpus(): LoadedCorpus;
