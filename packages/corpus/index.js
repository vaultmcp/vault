import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadCorpus() {
  const metaPath = path.join(here, 'embeddings-meta.json');
  const binPath = path.join(here, 'embeddings.bin');
  if (!existsSync(metaPath) || !existsSync(binPath)) {
    throw new Error(
      'vault/corpus: embeddings missing — run `pnpm --filter @vault/corpus build` first',
    );
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const buf = readFileSync(binPath);
  const expected = meta.count * meta.dim * 4;
  if (buf.byteLength !== expected) {
    throw new Error(
      `vault/corpus: bin size ${buf.byteLength} != expected ${expected} (count=${meta.count}, dim=${meta.dim})`,
    );
  }
  // Copy into a fresh buffer so the Float32Array is well-aligned and owns its memory.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const embeddings = new Float32Array(ab);
  return { meta, embeddings };
}
