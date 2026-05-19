# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

To report a vulnerability:

1. **Preferred**: Open a [GitHub Security Advisory](../../security/advisories/new) — this creates a private thread with the maintainers.
2. **Alternate**: Email the maintainer directly (address in the GitHub profile).

Include:
- Description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept payload, config, environment)
- Any suggested mitigations

We will acknowledge receipt within **48 hours** and aim to ship a patch within **7 days** for confirmed critical vulnerabilities.

## Scope

In-scope:
- Prompt injection bypasses (payloads that defeat L1/L2/L3 detection in block mode)
- Capability firewall bypasses (tainted content reaching sensitive tools without being gated)
- Manifest verification bypasses (tool drift not detected or incorrectly reported)
- Vulnerabilities in the attestation client (private key exposure, replay attacks)
- Command injection in the stdio transport (proxy spawning unintended processes)

Out of scope:
- Detection evasion in `warn` or `log` mode (those modes intentionally allow through)
- False positives (clean content blocked) — report as a regular issue
- Attacks requiring the attacker to already have code execution on the proxy host
- Social engineering

## Supported Versions

The most recent release on npm is the only supported version. We do not backport patches to older releases.

## Known Limitations

Vault is a defense-in-depth layer, not a complete solution:

- **Adversarial evasion**: A determined attacker with knowledge of the detection pipeline can craft payloads that evade L1 and L2. L3 (LLM judge) raises the bar significantly but is not infallible.
- **Semantic attacks**: Highly indirect or multi-step injections may not be detected by any layer.
- **Performance trade-off**: L3 adds ~1s latency per ambiguous response. Operators who disable L3 have weaker detection on borderline cases.
- **Capability firewall**: Taint tracking uses token overlap, not semantic similarity. A sufficiently paraphrased exfiltration may not be caught.

The goal is to make prompt injection attacks expensive and detectable — not to guarantee zero bypasses.
