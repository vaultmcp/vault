#!/usr/bin/env node
// Check minimum cosine distance from a text to all corpus entries.
// Usage: node check-corpus-distance.mjs "text to check"
//    OR: node check-corpus-distance.mjs --batch < texts.json   (reads JSON array of {id,text})
//
// Exits 0; prints JSON results.

import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function embed(text, extractor) {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return out.data;
}

function cosineDistance(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
}

function minDistToCorpus(q, embeddings, dim, count) {
  let best = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < count; i++) {
    let dot = 0;
    for (let j = 0; j < dim; j++) dot += q[j] * embeddings[i * dim + j];
    const d = 1 - dot;
    if (d < best) { best = d; bestIdx = i; }
  }
  return { dist: best, idx: bestIdx };
}

async function main() {
  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = true;

  const require = createRequire(import.meta.url);

  // Load corpus
  const corpusRoot = path.resolve(__dirname, '../../../corpus');
  const meta = JSON.parse(
    await import('fs').then(fs => fs.promises.readFile(path.join(corpusRoot, 'embeddings-meta.json'), 'utf8'))
  );
  const buf = await import('fs').then(fs => fs.promises.readFile(path.join(corpusRoot, 'embeddings.bin')));
  const embeddings = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const items = JSON.parse(
    await import('fs').then(fs => fs.promises.readFile(path.join(corpusRoot, 'injection-patterns.json'), 'utf8'))
  );

  const { dim, count } = meta;

  process.stderr.write('Loading model...\n');
  const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { quantized: true });
  process.stderr.write('Model ready.\n');

  const args = process.argv.slice(2);

  if (args[0] === '--batch') {
    // Read JSON array of {id, text} from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const entries = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const results = [];
    for (const entry of entries) {
      const q = await embed(entry.text, extractor);
      const { dist, idx } = minDistToCorpus(q, embeddings, dim, count);
      results.push({
        id: entry.id,
        min_dist: dist,
        nearest_corpus_id: items[idx]?.id,
        nearest_category: items[idx]?.category,
        pass: dist > 0.40,
      });
      process.stderr.write(`  ${entry.id}: dist=${dist.toFixed(4)} nearest=${items[idx]?.id} ${dist > 0.40 ? 'PASS' : 'FAIL'}\n`);
    }
    console.log(JSON.stringify(results, null, 2));
  } else {
    const text = args.join(' ');
    const q = await embed(text, extractor);
    const { dist, idx } = minDistToCorpus(q, embeddings, dim, count);
    console.log(JSON.stringify({
      min_dist: dist,
      nearest_corpus_id: items[idx]?.id,
      nearest_category: items[idx]?.category,
      pass: dist > 0.40,
    }, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
