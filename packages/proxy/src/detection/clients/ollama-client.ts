import {
  JUDGE_SYSTEM_PROMPT,
  type JudgeClient,
  type JudgeContext,
  type JudgeOutput,
} from './types.js';

const MAX_INPUT_CHARS = 4000;
const DEFAULT_MODEL = 'llama3.2:3b';
const DEFAULT_BASE_URL = 'http://localhost:11434';

function truncate(content: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_INPUT_CHARS) return { text: content, truncated: false };
  return { text: content.slice(0, MAX_INPUT_CHARS), truncated: true };
}

function formatUserMessage(content: string, context?: JudgeContext): string {
  const { text, truncated } = truncate(content);
  const header: string[] = [];
  if (context?.toolName) header.push(`Tool: ${context.toolName}`);
  if (context?.mcpMethod) header.push(`MCP method: ${context.mcpMethod}`);
  if (truncated) header.push(`Note: output truncated to first ${MAX_INPUT_CHARS} chars`);
  const headerBlock = header.length ? `[${header.join(' | ')}]\n\n` : '';
  return `${headerBlock}Tool output:\n${text}`;
}

const SYSTEM_PROMPT_WITH_SCHEMA = `${JUDGE_SYSTEM_PROMPT}

Respond with ONLY a JSON object matching this schema, no surrounding prose:
{
  "verdict": "clean" | "suspicious" | "malicious",
  "confidence": number between 0 and 1,
  "reasoning": "one short sentence",
  "detected_patterns": ["short", "labels"]
}`;

interface OllamaChatResponse {
  message?: { role?: string; content?: string };
}

export class OllamaJudge implements JudgeClient {
  public readonly providerName = 'ollama';
  public readonly modelName: string;
  private readonly baseUrl: string;

  constructor(opts: { model?: string; baseUrl?: string }) {
    this.modelName = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async judge(content: string, context?: JudgeContext): Promise<JudgeOutput> {
    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_WITH_SCHEMA },
          { role: 'user', content: formatUserMessage(content, context) },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`ollama judge: HTTP ${resp.status} ${body.slice(0, 200)}`);
    }

    const json = (await resp.json()) as OllamaChatResponse;
    const text = json.message?.content;
    if (!text) {
      process.stderr.write('vault: ollama judge returned empty content — treating as suspicious\n');
      return { verdict: 'suspicious', confidence: 0.5, reasoning: 'ollama: empty response', detected_patterns: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      process.stderr.write(`vault: ollama judge returned non-JSON — treating as suspicious: ${text.slice(0, 120)}\n`);
      return { verdict: 'suspicious', confidence: 0.5, reasoning: 'ollama: non-JSON response', detected_patterns: [] };
    }

    return parsed as JudgeOutput;
  }
}
