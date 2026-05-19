import { pipeline } from '@xenova/transformers';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const EXPECTED_DIM = 384;

interface Pattern {
  id: string;
  text: string;
  category: string;
  severity: 'low' | 'medium' | 'high';
  source?: string;
}

async function main(): Promise<void> {
  const patterns: Pattern[] = JSON.parse(
    readFileSync(path.join(__dirname, 'injection-patterns.json'), 'utf8'),
  );

  const seen = new Set<string>();
  for (const p of patterns) {
    if (seen.has(p.id)) throw new Error(`duplicate id: ${p.id}`);
    seen.add(p.id);
  }

  process.stderr.write(`vault/corpus: embedding ${patterns.length} patterns with ${MODEL_ID}\n`);
  const t0 = Date.now();

  const extractor = await pipeline('feature-extraction', MODEL_ID, { quantized: true });

  const buf = new Float32Array(patterns.length * EXPECTED_DIM);
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i]!;
    const out = await extractor(p.text, { pooling: 'mean', normalize: true });
    const data = out.data as Float32Array;
    if (data.length !== EXPECTED_DIM) {
      throw new Error(`unexpected embedding dim ${data.length} for ${p.id}`);
    }
    buf.set(data, i * EXPECTED_DIM);
  }

  writeFileSync(
    path.join(__dirname, 'embeddings.bin'),
    Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength),
  );
  writeFileSync(
    path.join(__dirname, 'embeddings-meta.json'),
    JSON.stringify(
      {
        dim: EXPECTED_DIM,
        count: patterns.length,
        model: MODEL_ID,
        items: patterns.map(({ id, category, severity }) => ({ id, category, severity })),
      },
      null,
      2,
    ) + '\n',
  );

  process.stderr.write(
    `vault/corpus: wrote ${patterns.length} embeddings in ${Date.now() - t0}ms\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`vault/corpus build failed: ${err}\n`);
  process.exit(1);
});
