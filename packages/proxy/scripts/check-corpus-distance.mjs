#!/usr/bin/env node
// Check minimum cosine distance from candidate texts to all corpus entries.
// Must be run from packages/proxy/ (has @xenova/transformers + @vaultmcp/corpus).
// Usage: cat texts.json | node scripts/check-corpus-distance.mjs --batch
//   where texts.json is a JSON array of {id, text} objects.

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { loadCorpus } from '@vaultmcp/corpus';

const { pipeline, env } = await import('@xenova/transformers');
env.allowLocalModels = true;

function cosineDistance(q, embeddings, offset, dim) {
  let dot = 0;
  for (let i = 0; i < dim; i++) dot += q[i] * embeddings[offset + i];
  return 1 - dot;
}

function minDist(q, embeddings, dim, count, items) {
  let best = Infinity, bestIdx = -1;
  for (let i = 0; i < count; i++) {
    const d = cosineDistance(q, embeddings, i * dim, dim);
    if (d < best) { best = d; bestIdx = i; }
  }
  return { dist: best, idx: bestIdx };
}

process.stderr.write('Loading corpus...\n');
const { meta, embeddings } = loadCorpus();
const { dim, count, items } = meta;

process.stderr.write('Loading model...\n');
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { quantized: true });
process.stderr.write('Ready.\n');

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const entries = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const results = [];
for (const entry of entries) {
  const out = await extractor(entry.text, { pooling: 'mean', normalize: true });
  const q = out.data;
  const { dist, idx } = minDist(q, embeddings, dim, count, items);
  const pass = dist > 0.40;
  results.push({
    id: entry.id,
    min_dist: parseFloat(dist.toFixed(4)),
    nearest_corpus_id: items[idx]?.id,
    nearest_category: items[idx]?.category,
    pass,
  });
  process.stderr.write(`  ${entry.id}: dist=${dist.toFixed(4)} nearest=${items[idx]?.id} ${pass ? 'PASS' : 'FAIL <0.40'}\n`);
}

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
