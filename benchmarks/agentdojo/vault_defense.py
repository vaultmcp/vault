"""Vault as an AgentDojo defense.

This does NOT reimplement Vault's logic. It shells out to the real `vault decide` binary
(packages/proxy/dist/decide.js), which runs the exact decideCapability + decideTradePolicy
engine the shipped proxy uses. That way the benchmark scores the actual product.

VaultActionGuard is a pipeline element placed BEFORE ToolsExecutor in the tools loop. For
each tool call the LLM proposes, it asks Vault whether to allow it, given the tool outputs
seen so far this turn (so a recipient lifted from an injected tool response is caught as
tainted). Blocked calls are removed from the assistant message, so they never execute and
the attacker's money movement never lands in the final environment state, which is exactly
what AgentDojo's security check measures.

The recipient allowlist is derived from the environment: the accounts the user has actually
transacted with before, plus their own IBAN. That is a real, defensible control ("only
auto-send to payees you've paid before"), not something hardcoded to beat the benchmark.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Sequence
from pathlib import Path

from agentdojo.agent_pipeline.base_pipeline_element import BasePipelineElement
from agentdojo.functions_runtime import EmptyEnv, Env, FunctionsRuntime
from agentdojo.types import ChatMessage, get_text_content_as_str

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DECIDE_JS = _REPO_ROOT / "packages" / "proxy" / "dist" / "decide.js"

# Tool names in AgentDojo's banking suite that move money.
BANKING_MONEY_TOOLS = "send_money,schedule_transaction,update_scheduled_transaction,transfer,send"


def _known_payees(env: Env) -> list[str]:
    """Legitimate recipients: the user's own IBAN plus everyone they've paid before."""
    payees: set[str] = set()
    account = getattr(env, "bank_account", None)
    if account is None:
        return []
    own = getattr(account, "iban", None)
    if isinstance(own, str) and own:
        payees.add(own)
    for t in getattr(account, "transactions", []) or []:
        r = getattr(t, "recipient", None)
        if isinstance(r, str) and r:
            payees.add(r)
    return sorted(payees)


class VaultActionGuard(BasePipelineElement):
    """Blocks money-moving tool calls that Vault's action layer rejects, before they run."""

    name = "vault_action_guard"

    def __init__(self, money_tools: str = BANKING_MONEY_TOOLS, decide_js: Path = _DECIDE_JS):
        super().__init__()
        self.money_tools = money_tools
        self.decide_js = decide_js
        if not self.decide_js.exists():
            raise FileNotFoundError(
                f"vault decide binary not found at {self.decide_js}. Build it: "
                f"pnpm --filter @aimcpvault/mcp-proxy build"
            )

    def _decide(self, prior_outputs: list[dict], tool_calls: list, allowlist: list[str]) -> list[dict]:
        req = {
            "priorOutputs": prior_outputs,
            "toolCalls": [{"toolName": tc.function, "args": dict(tc.args)} for tc in tool_calls],
        }
        env = {
            **os.environ,
            "VAULT_TRADE_GUARD": "1",
            "VAULT_TRADE_ALLOWLIST": ",".join(allowlist),
            "VAULT_TRADE_SWAP_TOOLS": self.money_tools,
            "VAULT_TRADE_RECIPIENT_KEYS": "recipient,to,destination,dest,receiver",
            "VAULT_TRADE_AMOUNT_KEYS": "amount,value",
        }
        proc = subprocess.run(
            ["node", str(self.decide_js)],
            input=json.dumps(req),
            capture_output=True,
            text=True,
            env=env,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"vault decide failed: {proc.stderr.strip()}")
        return json.loads(proc.stdout)["decisions"]

    def query(
        self,
        query: str,
        runtime: FunctionsRuntime,
        env: Env = EmptyEnv(),
        messages: Sequence[ChatMessage] = [],
        extra_args: dict = {},
    ) -> tuple[str, FunctionsRuntime, Env, Sequence[ChatMessage], dict]:
        if not messages:
            return query, runtime, env, messages, extra_args
        last = messages[-1]
        if last["role"] != "assistant" or not last.get("tool_calls"):
            return query, runtime, env, messages, extra_args

        tool_calls = list(last["tool_calls"])
        prior_outputs = [
            {
                "toolName": (m.get("tool_call").function if m.get("tool_call") else "tool"),
                "content": get_text_content_as_str(m["content"]) or "",
            }
            for m in messages
            if m["role"] == "tool" and m.get("content")
        ]

        decisions = self._decide(prior_outputs, tool_calls, _known_payees(env))

        allowed = []
        blocked = []
        for tc, d in zip(tool_calls, decisions):
            if d.get("action") == "block":
                blocked.append({"function": tc.function, "args": dict(tc.args), "reason": d.get("reason")})
            else:
                allowed.append(tc)

        if blocked:
            last["tool_calls"] = allowed  # erased calls never reach ToolsExecutor
            extra_args.setdefault("vault_blocked", []).extend(blocked)

        return query, runtime, env, messages, extra_args
