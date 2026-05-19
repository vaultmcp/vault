// Measures Layer 3 latency floor. Run with:
//   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @vault/mcp-proxy bench:l3
//
// Copy the printed numbers into the header of src/detection/layer3-judge.ts
// and set VAULT_LAYER3_TIMEOUT_MS = ceil(p99 of your typical input * 1.5).

import Anthropic from '@anthropic-ai/sdk';
import { JUDGE_SYSTEM_PROMPT, JUDGE_TOOL_SCHEMA } from '../src/detection/clients/types.js';

const MODEL = process.env.VAULT_LAYER3_MODEL ?? 'claude-haiku-4-5-20251001';

function makeInput(approxTokens: number): string {
  const sentence =
    'The quarterly business review covered EMEA expansion plans, headcount projections, and the rollout schedule. ';
  const targetChars = approxTokens * 4;
  let s = '';
  while (s.length < targetChars) s += sentence;
  return s.slice(0, targetChars);
}

async function timed(client: Anthropic, input: string): Promise<number> {
  const t0 = Date.now();
  await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: JUDGE_SYSTEM_PROMPT,
    tools: [
      {
        name: 'submit_verdict',
        description: 'Submit the prompt-injection classification verdict.',
        input_schema: JUDGE_TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_verdict' },
    messages: [{ role: 'user', content: input }],
  });
  return Date.now() - t0;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p) - 1));
  return sorted[idx]!;
}

async function bench(client: Anthropic, label: string, tokens: number, n = 20): Promise<void> {
  const input = makeInput(tokens);
  process.stderr.write(`bench: warmup ${label}...\n`);
  await timed(client, input);
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    samples.push(await timed(client, input));
    process.stderr.write('.');
  }
  process.stderr.write('\n');
  samples.sort((a, b) => a - b);
  process.stdout.write(
    `${label}: p50=${percentile(samples, 0.5)}ms p99=${percentile(samples, 0.99)}ms min=${samples[0]}ms max=${samples.at(-1)}ms (n=${n})\n`,
  );
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('Set ANTHROPIC_API_KEY to run this benchmark.\n');
    process.exit(1);
  }
  const client = new Anthropic();
  process.stdout.write(`model: ${MODEL}\n`);
  await bench(client, '200 tokens', 200);
  await bench(client, '2000 tokens', 2000);
  await bench(client, '8000 tokens', 8000);
}

main().catch((err) => {
  process.stderr.write(`bench failed: ${err}\n`);
  process.exit(1);
});
