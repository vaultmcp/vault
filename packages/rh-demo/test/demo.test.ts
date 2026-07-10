import { beforeAll, describe, expect, it } from 'vitest';
import { naiveAgent } from '../src/agent.js';
import { guardToolResponse, warmupLayer2 } from '../src/guard.js';
import { TradingServer } from '../src/trading-server.js';
import { findScenario } from '../src/scenario.js';
import { AGENT_WALLET, ATTACKER_WALLET } from '../src/chain.js';

const server = new TradingServer();

function textsFor(id: string): string[] {
  return [server.get_token_metadata(id).text, server.get_quote(id).text];
}

describe('naive (un-guarded) agent', () => {
  it('routes the clean scenario to the user wallet', () => {
    const d = naiveAgent(textsFor('clean-tAAPL'));
    expect(d.recipient).toBe(AGENT_WALLET);
    expect(d.followedInjection).toBe(false);
  });

  it('is hijacked to the attacker by the blatant injection', () => {
    const d = naiveAgent(textsFor('poisoned-tTSLA-blatant'));
    expect(d.recipient).toBe(ATTACKER_WALLET);
    expect(d.followedInjection).toBe(true);
  });

  it('is hijacked to the attacker by the subtle injection', () => {
    const d = naiveAgent(textsFor('poisoned-tNVDA-subtle'));
    expect(d.recipient).toBe(ATTACKER_WALLET);
  });
});

describe('Vault guard (L1+L2, no API key)', () => {
  beforeAll(async () => {
    await warmupLayer2();
  }, 60_000);

  it('passes a clean tool response through', async () => {
    const s = findScenario('clean-tAAPL')!;
    const o = await guardToolResponse('get_token_metadata', server.get_token_metadata(s.id));
    expect(o.blocked).toBe(false);
  });

  it('blocks the blatant injection deterministically via L1', async () => {
    const o = await guardToolResponse(
      'get_token_metadata',
      server.get_token_metadata('poisoned-tTSLA-blatant'),
    );
    expect(o.blocked).toBe(true);
    expect(o.result.verdict).toBe('malicious');
    expect(o.result.layer).toBe(1);
  });

  it('escalates the subtle injection into the L3 gate zone (distance < 0.50)', async () => {
    // Without a key L3 is offline, so this stays clean here — but the distance proves
    // the pipeline WOULD invoke the L3 judge when ANTHROPIC_API_KEY is set.
    const o = await guardToolResponse('get_quote', server.get_quote('poisoned-tNVDA-subtle'));
    expect(o.result.distance).toBeLessThan(0.5);
  });
});
