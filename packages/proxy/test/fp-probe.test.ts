// Real-content false-positive probe.
//
// Runs the full Layers 1 + 2 detection pipeline against a corpus of legitimate technical content
// (blockchain security scanner marketing, MCP docs, prompt-injection research excerpts, OS docs) and asserts
// that none of it is flagged. When this test fails, the failure message names the offending fixture
// and the matched pattern so the regex / threshold can be tuned.
//
// To extend: add more `{ name, text }` entries to LEGIT_CORPUS. Run with `pnpm test fp-probe`.

import { describe, it, expect, beforeAll } from 'vitest';
import { runLayer1 } from '../src/detection/layer1-heuristics.js';
import { runLayer2, warmupLayer2 } from '../src/detection/layer2-embeddings.js';
import { runPipeline } from '../src/detection/pipeline.js';
import { _setClientForTesting } from '../src/detection/layer3-judge.js';

interface LegitFixture {
  name: string;
  text: string;
}

// Fixtures captured from real public sources (May 2026). These are legitimate technical content
// that an MCP agent might read; flagging any of them is a false positive.
const LEGIT_CORPUS: LegitFixture[] = [
  {
    name: 'blockchain security scanner marketing page',
    text:
      'Argus is an autonomous security scanning platform designed for blockchain smart contracts, particularly on Base and Solana. The service combines pattern detection with AI analysis to identify vulnerabilities before deployment. ' +
      'Core Capabilities. The platform operates through several integrated components. Scanner Engine: Runs 180 detectors across smart contracts, infrastructure, and application code. Detection focuses on known exploit patterns, hardcoded secrets, authorization flaws, and Solidity-specific antipatterns. ' +
      'Hack Replay Templates: Encodes 12 major cryptocurrency exploits (Bybit, Radiant, Euler, zkSync, and others) as detection patterns. Users can run: "argus replay --hack=bybit" to test against their contracts. ' +
      'Working Proof-of-Concepts: For critical findings, Argus generates executable Foundry tests that simulate exploits on forked mainnet, providing concrete evidence of vulnerability. ' +
      'Onchain Attestations: Every paid scan creates a permanent record via EAS on Base, generating a public, verifiable receipt. ' +
      'The platform explicitly states what it is not: a replacement for human audits, a guarantee of safety, or suitable as the sole security layer for contracts handling >$5M.',
  },
  {
    name: 'modelcontextprotocol.io intro',
    text:
      'MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. ' +
      'Using MCP, AI applications like Claude or ChatGPT can connect to data sources (e.g. local files, databases), tools (e.g. search engines, calculators) and workflows (e.g. specialized prompts)—enabling them to access key information and perform tasks. ' +
      'Think of MCP like a USB-C port for AI applications. Just as USB-C provides a standardized way to connect electronic devices, MCP provides a standardized way to connect AI applications to external systems. ' +
      'What can MCP enable? Agents can access your Google Calendar and Notion, acting as a more personalized AI assistant. Claude Code can generate an entire web app using a Figma design. Enterprise chatbots can connect to multiple databases across an organization, empowering users to analyze data using chat. AI models can create 3D designs on Blender and print them out using a 3D printer. ' +
      'Why does MCP matter? Developers: MCP reduces development time and complexity when building, or integrating with, an AI application or agent. AI applications or agents: MCP provides access to an ecosystem of data sources, tools and apps which will enhance capabilities and improve the end-user experience. ' +
      'MCP is an open protocol supported across a wide range of clients and servers.',
  },
  {
    name: 'prompt injection research abstract',
    text:
      'Recent research has examined attacks in which adversaries embed instructions into untrusted documents that an LLM-driven agent subsequently reads. These indirect prompt injection attacks aim to override the assistant\u2019s original instructions and cause unintended actions such as exfiltration or unauthorized tool use. ' +
      'Researchers have proposed layered defenses combining pattern heuristics, embedding similarity, and judge models. No single layer is sufficient; multi-layered detection paired with capability constraints remains an open problem.',
  },
  {
    name: 'README-style installation guide',
    text:
      'Installation. Run npm install --save my-package to add the dependency. Then create a config file at .config/my-package/settings.json with your API endpoint and credentials. ' +
      'See the documentation at https://docs.example-company.com/getting-started for a full walkthrough. For support, file an issue on GitHub or join our community on Discord. ' +
      'Configuration options include: port (default 3000), host (default localhost), and verbose (default false). All options can be overridden via environment variables prefixed with MY_PACKAGE_.',
  },
  {
    name: 'engineering blog post excerpt',
    text:
      'We rebuilt our authentication middleware last quarter after a postmortem revealed that mocked tests had been passing while production migrations silently failed. The takeaway: integration tests must hit a real database, not a mock. ' +
      'Our new architecture uses ephemeral test databases spun up in CI, with migrations applied fresh per test run. Initial benchmarks show a 30% increase in CI wall-clock time but a 90% reduction in regression incidents that escape to production. ' +
      'For teams considering similar changes, we recommend phasing the rollout: start with critical-path endpoints, expand outward, and never trust a green test suite that does not exercise the real persistence layer.',
  },
  {
    name: 'changelog entry',
    text:
      'v2.4.0 (2026-04-15). Added support for streaming responses via Server-Sent Events. The new /v1/stream endpoint accepts standard request bodies and emits incremental chunks. ' +
      'Breaking: deprecated the /v1/legacy-batch endpoint, scheduled for removal in v3.0. Migration guide at https://docs.example.com/migrations/v2-to-v3. ' +
      'Fixed: a race condition in connection pooling that occasionally returned stale cached results under high concurrency. Performance: median p99 latency reduced from 240ms to 160ms following the connection-reuse optimization.',
  },
  {
    name: 'OpenAPI snippet',
    text:
      'paths: /users/{id}: get: summary: Retrieve a user. parameters: - name: id in: path required: true schema: type: integer responses: 200: description: A single user object. content: application/json: schema: $ref: #/components/schemas/User. 404: description: User not found.',
  },
  {
    name: 'security advisory phrasing',
    text:
      'CVE-2026-12345: A reflected cross-site scripting vulnerability in the search-results page allowed attackers to inject arbitrary HTML via the q query parameter. Affected versions: 1.0.0 through 1.4.2. ' +
      'Mitigation: upgrade to 1.4.3 or later. Workaround: configure your reverse proxy to strip non-alphanumeric characters from the q parameter. ' +
      'Credit: reported by an independent researcher through the responsible-disclosure program. No exploitation in the wild has been observed.',
  },
  {
    // Real-world fixture: filesystem MCP server README — this is the exact failure mode
    // that surfaced the c-26 FP. Documentation describing file operations near-matched the
    // exfiltration corpus category. Must stay clean under the FP-tuned pipeline.
    name: 'filesystem MCP server README excerpt',
    text:
      'Filesystem MCP Server. Node.js server implementing Model Context Protocol (MCP) for filesystem operations. ' +
      'Features: Read/write files, Create/list/delete directories, Move files/directories, Search files, Get file metadata. ' +
      'Tools: read_text_file — Read complete contents of a file as text. Inputs: path (string), head (number, optional): First N lines, tail (number, optional): Last N lines. ' +
      'write_file — Create new file or overwrite existing. Inputs: path (string): File location, content (string): File content. ' +
      'edit_file — Make selective edits using advanced pattern matching. Inputs: path (string), edits (array). ' +
      'create_directory — Create new directory or ensure it exists. Input: path (string). ' +
      'list_directory — List directory contents with [FILE] or [DIR] prefixes. Input: path (string). ' +
      'search_files — Recursively search for files/directories that match patterns. Returns full paths to matches. ' +
      'list_allowed_directories — List all directories the server is allowed to access.',
  },
  {
    // Real-world fixture: MCP servers index README — heavy in "server", "tools", "access",
    // "secure" terminology that the bge-small embedder might confuse for attack categories.
    name: 'MCP servers index README excerpt',
    text:
      'Model Context Protocol servers. This repository is a collection of reference implementations for the Model Context Protocol (MCP). ' +
      'The servers showcase the versatility and extensibility of MCP, demonstrating how it can be used to give Large Language Models secure, controlled access to tools and data sources. ' +
      'Reference Servers: Filesystem — Secure file operations with configurable access controls. Git — Tools to read, search, and manipulate Git repositories. ' +
      'Memory — Knowledge graph-based persistent memory system. Fetch — Web content fetching and conversion for efficient LLM usage. ' +
      'These reference implementations demonstrate MCP features and SDK usage. They are meant to serve as educational examples for developers building their own MCP servers, not as production-ready solutions.',
  },
  {
    name: 'fictional log of agent tool use',
    text:
      '[10:23:04.123] agent: requesting tool read_file with path="/tmp/cache/build-2026-05-19.log" ' +
      '[10:23:04.140] tool: returned 1.2 MB of compressed text. ' +
      '[10:23:04.310] agent: summarizing the log to identify build failures. ' +
      '[10:23:06.220] agent: found 3 failing test suites. Reporting to user. ' +
      '[10:23:06.230] agent: tool call complete, returning result.',
  },
  {
    name: 'security training presentation',
    text:
      'Slide 4 of 12: Defense in depth against prompt injection. The threat model assumes adversarial content can be ' +
      'embedded in any tool output an agent reads. Detection alone is insufficient because no classifier achieves ' +
      '100% recall. Capability constraints on the agent — limits on what tools can be invoked and with what arguments ' +
      'after reading untrusted content — provide a second line of defense. This is the approach taken by recent work ' +
      'including Google\u2019s CaMeL (Capability Mediation Layer) and several commercial agent security products.',
  },
];

interface ProbeResult {
  name: string;
  layer1Verdict: string;
  layer1Patterns: string[];
  layer2Verdict: string;
  layer2Distance: number | undefined;
  pipelineVerdict: string;
  pipelineLayer: number | undefined;
}

describe('false-positive probe against real legitimate content', () => {
  beforeAll(async () => {
    // No L3 client → pipeline falls back to L2 when L3 would otherwise fire.
    _setClientForTesting(null);
    await warmupLayer2();
  }, 60000);

  it('reports per-fixture verdicts and flags any non-clean detection', async () => {
    const results: ProbeResult[] = [];
    for (const fx of LEGIT_CORPUS) {
      const l1 = runLayer1(fx.text);
      const l2 = await runLayer2(fx.text);
      const pipe = await runPipeline(fx.text, { toolName: 'read_file', mcpMethod: 'tools/call' });
      results.push({
        name: fx.name,
        layer1Verdict: l1.verdict,
        layer1Patterns: l1.detectedPatterns,
        layer2Verdict: l2.verdict,
        layer2Distance: l2.distance,
        pipelineVerdict: pipe.verdict,
        pipelineLayer: pipe.layer,
      });
    }

    // Pretty-print every fixture's full result for visibility.
    console.log('FP probe results:');
    for (const r of results) {
      const dist = r.layer2Distance !== undefined ? r.layer2Distance.toFixed(3) : 'n/a';
      console.log(
        `  - ${r.name}\n      L1=${r.layer1Verdict} [${r.layer1Patterns.join(',') || 'none'}]` +
          `\n      L2=${r.layer2Verdict} dist=${dist}` +
          `\n      pipeline=${r.pipelineVerdict} (L${r.pipelineLayer ?? '?'})`,
      );
    }

    const flagged = results.filter(
      (r) => r.layer1Verdict !== 'clean' || r.layer2Verdict !== 'clean' || r.pipelineVerdict !== 'clean',
    );

    if (flagged.length > 0) {
      const detail = flagged
        .map(
          (r) =>
            `${r.name}: L1=${r.layer1Verdict}[${r.layer1Patterns.join(',')}] L2=${r.layer2Verdict}(d=${r.layer2Distance?.toFixed(3)})`,
        )
        .join(' | ');
      throw new Error(`false positives detected: ${detail}`);
    }

    expect(flagged).toHaveLength(0);
  }, 60000);
});
