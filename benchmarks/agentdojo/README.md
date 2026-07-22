# Vault on AgentDojo

Proof that Vault's **action layer** stops agent attacks that content filtering misses, scored
on a third-party benchmark instead of one we made up.

## Why AgentDojo (and not our own benchmark)

Inventing your own security benchmark reads as cherry-picking. [AgentDojo](https://github.com/ethz-spylab/agentdojo)
(ETH Zurich, NeurIPS 2024) is the credible one for this claim:

- It scores the **action**, not the text. Its `security` check inspects the final environment
  state, e.g. "did a transfer to the attacker's IBAN actually land." A defense that flags the
  injection but still lets the money move scores as a **failure**. That is exactly the gap we
  target.
- It has a **banking** suite (money-movement tools), which is our ICP.
- It measures **utility** too, so a defense that blocks everything doesn't win.

We plug Vault in as a defense and report Vault against real baselines on their harness.

## What's here

- `vault_defense.py` — `VaultActionGuard`, an AgentDojo pipeline element placed before tool
  execution. It does **not** reimplement Vault; it shells out to the real `vault decide`
  binary (`packages/proxy/dist/decide.js`), which runs the shipped `decideCapability` +
  `decideTradePolicy` engine. The recipient allowlist is derived from the environment (payees
  the user has actually paid before), which is a real control, not a benchmark hack.
- `run_bench.py` — runs the banking suite across three arms and reports Targeted ASR.
- `test_action_guard.py` — deterministic, **no LLM/API cost**: proves the guard blocks the
  banking attacker IBAN and passes a known payee, in AgentDojo's exact message format.

## The three arms

| Arm | What it is |
|---|---|
| `nodefense` | unprotected agent — the attack-success ceiling |
| `spotlighting` | AgentDojo's built-in content defense (a cited content-filter baseline) |
| `vault` | Vault's action layer in front of tool execution |

**Targeted ASR** = fraction of injection tasks where the attacker's action landed in final
state (lower is better). **Utility under attack** = fraction where the user's real task still
completed (higher is better). The money shot is the row where the content filter's ASR stays
high (it flagged text but the transfer still executed) while Vault's ASR goes to ~0 (it let the
text through the scan but blocked the action).

## Run it

```bash
python3.13 -m venv .venv && ./.venv/bin/pip install agentdojo
pnpm --filter @aimcpvault/mcp-proxy build          # builds the `decide` binary

# cost-free: prove the guard blocks the real banking attack
./.venv/bin/python test_action_guard.py

# the paid eval (needs an LLM key; start cheap with Haiku + a subset)
export ANTHROPIC_API_KEY=...
./.venv/bin/python run_bench.py --model claude-3-5-haiku-20241022 \
    --injection-tasks injection_task_0 injection_task_1
# drop --injection-tasks for the full suite; add --model gpt-4o for a second base model
```

## Honesty notes (read before quoting numbers)

- **Adaptive attacks are the standard.** Per [arXiv 2503.00061](https://arxiv.org/abs/2503.00061),
  a defense must survive attackers who know it's there. Static-attack numbers alone are not
  enough; report adaptive results too.
- **Report utility/false-positives**, not just ASR. Our known-payee allowlist can block a
  legitimate first-time payee — that trade-off has to be shown, not hidden.
- **On-chain receipts are audit, not the headline metric.** The headline is Targeted ASR on
  AgentDojo. Receipts are tamper-evident logging of what was blocked.
- **Where Vault is not novel** (per landscape research): injection scanning and tool
  allowlisting are commoditized (Invariant/Snyk, others). The defensible story is the
  action layer for trading plus per-tool behavioral reputation. Benchmark accordingly.
