# Corpus Sources — Day 1 Sprint

Every source listed here is EXCLUDED from the Day 2 holdout build.
Format: `<source> — used for: <categories>`

## Sources used

- garak/probes/dan.py (github.com/leondz/garak) — used for: role_hijack, jailbreak (DAN 5/6/7/10/11/12, AIM, EvilBOT, STAN, DUDE, AntiDAN variants)
- garak/probes/encoding.py (github.com/leondz/garak) — used for: encoded_payload, instruction_override (ROT13, Morse, NATO phonetic, ASCII art, leet-speak, homoglyph, character substitution)
- Greshake et al. 2023 "Not what you've signed up for" arxiv.org/abs/2302.12173 — used for: instruction_override, exfiltration, multi_turn_setup (indirect injection via search index, documents, tool output, memory poisoning, shared resources, §4.1–4.4)
- OWASP LLM Top 10 owasp.org/www-project-top-10-for-large-language-model-applications/ — used for: instruction_override, exfiltration, jailbreak (LLM01 prompt injection examples, LLM02 insecure output handling, LLM06 sensitive information disclosure)
