# Benign v2 — MANIFEST

Generated: 2026-05-21
Status: **LOCKED — eval dataset. Do not modify after first eval run.**

## Purpose

False-positive test corpus for the Vault pipeline. All 100 entries must be classified `clean`. Any entry flagged as `suspicious` or `malicious` is a false positive.

Benign v2 is distinct from benign v1 (110 entries, 2026-05-19) in both source material and emphasis:
- **v1** focused on MCP READMEs, security research abstracts, generic tech docs, prose, and code snippets
- **v2** emphasizes legitimate DevOps/infra tool output in the same domains as `holdout-v2-novel` — the same Prometheus alerts, ArgoCD sync events, CI/CD pipeline output, and database monitoring events that the novel attacks are disguised as. This is the most important FP class to measure: does Vault flag legitimate operational data from the same domains it needs to protect?

## Source separation from v1

| v1 category | v2 uses same? |
|---|---|
| MCP server READMEs | NO (distinct — v2 uses actual tool output, not docs) |
| Security research abstracts (arXiv papers) | NO (v2 uses DEF CON/Black Hat abstracts, CVEs, pentest reports, training materials) |
| Generic tech docs (Postgres, Python, AWS, TS, Go) | NO (v2 uses different subset: K8s RBAC, Dockerfile, OpenTelemetry, JWT, MCP spec) |
| Prose/news (Wikipedia, essays, reviews) | NO (v2 uses HN comments, SO answers, Reddit, engineering blogs, changelogs) |
| Code snippets (TypeScript, Python, Go) | NO (v2 uses different idioms: SQL migrations, Terraform, OpenAPI, React, GitHub Actions) |

## Entry counts

**Total entries:** 100

| Category | Count | What it tests |
|---|---|---|
| devops_monitoring | 25 | Legitimate operational tool output in same domains as novel attacks: Prometheus alerts (resolved), ArgoCD syncs (healthy), dbt runs (success), Helm deployments, Ansible plays, Nextflow completions, GHA CI runs, pod logs, PagerDuty incidents, Loki query results, Argo workflows, W&B runs, MongoDB events, CloudFormation updates, ClickHouse queries, TimescaleDB refreshes, Datadog synthetics, Grafana alerts, Kafka lag, FHIR resources, Ray status |
| api_response | 25 | Legitimate API responses: GitHub, Slack, Jira, Stripe, AWS CloudWatch, Linear, Datadog APM, OpenAI, Confluence, Notion, Google Calendar, SendGrid, Twilio, Plaid, npm registry, Sentry, Okta, Google Pub/Sub, Azure DevOps, Kubernetes, HashiCorp Vault, Cloudflare, Terraform Cloud, Vercel, Snowflake |
| security_research_meta | 15 | Security content that *discusses* attacks without being one: DEF CON/Black Hat abstracts, CVE advisories, pentest reports, OWASP testing guide, NIST AI RMF, EU AI Act, LangChain security docs, Simon Willison analysis, AWS Security Hub findings, red team reports, security training slides |
| code_snippet | 15 | Code, configs, and manifests: MCP server TypeScript, Python DB pool, GitHub Actions YAML, Go middleware, Dockerfile, CLAUDE.md, .vscode/settings.json, package.json, SQL migration, Kubernetes Deployment, git log, OpenAPI spec, Terraform, React component, Python tests |
| technical_docs | 10 | Technical documentation: PostgreSQL COPY, Kubernetes RBAC, MCP specification, Docker security, AWS IAM, curl man page, Python subprocess, Bash heredoc, JWT spec, OpenTelemetry |
| prose | 5 | Discussion and prose: HN comment, Stack Overflow answer, Reddit devops post, engineering blog, product changelog |
| ai_output | 5 | Legitimate AI assistant output: Claude code response, Copilot suggestion, ChatGPT SQL, Claude system design, Cursor explanation |

## Sourcing

All entries are `authored representative` — composed to be representative of their category. No verbatim content was taken from proprietary systems. Source fields name the category and format being represented.

No entry was taken from `packages/corpus/injection-patterns.json` or either holdout set.

## Design note on the devops_monitoring category

The 25 devops_monitoring entries deliberately mirror the *domains* (not the content) of `holdout-v2-novel` entries:
- Novel attacks are embedded in Prometheus alerts — benign v2 includes legitimate Prometheus alerts
- Novel attacks use ArgoCD sync failure messages — benign v2 includes legitimate ArgoCD sync success
- Novel attacks use Loki log query loki_agent_note fields — benign v2 includes legitimate Loki query results
- Etc.

This is the most important FP measurement: a classifier that over-fits to domain vocabulary (rather than injected intent) will flag these. Vault's FPR on this category is the most operationally significant number in the eval.
