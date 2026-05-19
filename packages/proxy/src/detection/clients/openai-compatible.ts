import {
  JUDGE_SYSTEM_PROMPT,
  type JudgeClient,
  type JudgeContext,
  type JudgeOutput,
} from './types.js';

const MAX_INPUT_CHARS = 4000;

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

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAICompatibleJudge implements JudgeClient {
  public readonly providerName: string;
  public readonly modelName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: { apiKey: string; model: string; baseUrl: string; providerName?: string }) {
    this.apiKey = opts.apiKey;
    this.modelName = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.providerName = opts.providerName ?? 'openai-compatible';
  }

  async judge(content: string, context?: JudgeContext): Promise<JudgeOutput> {
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 256,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_WITH_SCHEMA },
          { role: 'user', content: formatUserMessage(content, context) },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`openai-compatible judge: HTTP ${resp.status} ${body.slice(0, 200)}`);
    }

    const json = (await resp.json()) as ChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error('openai-compatible judge: empty completion');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`openai-compatible judge: non-JSON response: ${text.slice(0, 200)}`);
    }

    return parsed as JudgeOutput;
  }
}
