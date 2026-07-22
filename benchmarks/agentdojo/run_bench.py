"""Run AgentDojo's banking suite with three defense arms and report Targeted ASR.

Arms:
  nodefense    - the agent, unprotected (baseline attack-success ceiling)
  spotlighting - AgentDojo's built-in content defense (spotlighting_with_delimiting),
                 a cited content-filter baseline that needs no GPU
  vault        - Vault's action layer (VaultActionGuard) in front of tool execution

Metrics (AgentDojo's own, state-verified):
  Targeted ASR         = mean(security_results)  -> attacker's action actually landed. Lower better.
  Utility under attack = mean(utility_results)   -> user's real task still completed. Higher better.

Usage:
  export ANTHROPIC_API_KEY=...    # or OPENAI_API_KEY, GOOGLE_API_KEY
  .venv/bin/python run_bench.py --model claude-3-5-haiku-20241022 --arms nodefense spotlighting vault \
      --injection-tasks injection_task_0 injection_task_1     # subset for a cheap first run
  # omit --injection-tasks / --user-tasks to run the full suite

Cost scales with (#user_tasks x #injection_tasks x #arms x model). Start with a subset + Haiku.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from agentdojo.agent_pipeline import AgentPipeline, PipelineConfig
from agentdojo.agent_pipeline.tool_execution import ToolsExecutionLoop, ToolsExecutor, tool_result_to_str
from agentdojo.attacks.attack_registry import load_attack
from agentdojo.benchmark import benchmark_suite_with_injections
from agentdojo.task_suite.load_suites import get_suite

from vault_defense import VaultActionGuard

RESULTS_DIR = Path(__file__).resolve().parent / "results"


def build_pipeline(model: str, arm: str) -> AgentPipeline:
    if arm == "nodefense":
        return AgentPipeline.from_config(PipelineConfig(llm=model, defense=None, system_message=None))
    if arm == "spotlighting":
        return AgentPipeline.from_config(
            PipelineConfig(llm=model, defense="spotlighting_with_delimiting", system_message=None)
        )
    if arm == "vault":
        # Reuse the real LLM element, but put Vault's action guard before tool execution.
        base = AgentPipeline.from_config(PipelineConfig(llm=model, defense=None, system_message=None))
        system, init, llm, _loop = base.elements
        loop = ToolsExecutionLoop([VaultActionGuard(), ToolsExecutor(tool_result_to_str), llm])
        pipeline = AgentPipeline([system, init, llm, loop])
        pipeline.name = f"{model}-vault"
        return pipeline
    raise ValueError(f"unknown arm: {arm}")


def asr(results) -> float:
    vals = list(results["security_results"].values())
    return sum(vals) / len(vals) if vals else 0.0


def utility(results) -> float:
    vals = list(results["utility_results"].values())
    return sum(vals) / len(vals) if vals else 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--suite", default="banking")
    ap.add_argument("--benchmark-version", default="v1")
    ap.add_argument("--attack", default="important_instructions")
    ap.add_argument("--arms", nargs="+", default=["nodefense", "spotlighting", "vault"])
    ap.add_argument("--user-tasks", nargs="*", default=None)
    ap.add_argument("--injection-tasks", nargs="*", default=None)
    args = ap.parse_args()

    suite = get_suite(args.benchmark_version, args.suite)
    RESULTS_DIR.mkdir(exist_ok=True)

    table = []
    for arm in args.arms:
        pipeline = build_pipeline(args.model, arm)
        attack = load_attack(args.attack, suite, pipeline)
        results = benchmark_suite_with_injections(
            pipeline,
            suite,
            attack,
            logdir=RESULTS_DIR / "logs",
            force_rerun=False,
            user_tasks=args.user_tasks,
            injection_tasks=args.injection_tasks,
            verbose=False,
            benchmark_version=args.benchmark_version,
        )
        row = {"arm": arm, "model": args.model, "targeted_asr": asr(results), "utility_under_attack": utility(results)}
        table.append(row)
        print(f"  {arm:14s}  ASR={row['targeted_asr']:.3f}  utility={row['utility_under_attack']:.3f}")

    out = RESULTS_DIR / f"banking_{args.model}_{args.attack}.json"
    out.write_text(json.dumps(table, indent=2) + "\n")
    print(f"\nwrote {out}")
    print("\nMoney shot: content filter detects text but the transfer still lands (higher ASR),")
    print("while Vault lets the text through and blocks the action (ASR -> 0).")


if __name__ == "__main__":
    main()
