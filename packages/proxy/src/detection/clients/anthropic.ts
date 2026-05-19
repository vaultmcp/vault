import {
  JUDGE_SYSTEM_PROMPT,
  JUDGE_TOOL_SCHEMA,
  type JudgeClient,
  type JudgeContext,
  type JudgeOutput,
} from './types.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
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

export class AnthropicJudge implements JudgeClient {
  public readonly providerName = 'anthropic';
  public readonly modelName: string;
  private clientPromise: Promise<unknown> | null = null;
  private readonly apiKey: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.modelName = opts.model ?? DEFAULT_MODEL;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod = await import('@anthropic-ai/sdk');
        const Anthropic = mod.default;
        return new Anthropic({ apiKey: this.apiKey });
      })();
    }
    return this.clientPromise;
  }

  async judge(content: string, context?: JudgeContext): Promise<JudgeOutput> {
    const client = (await this.getClient()) as {
      messages: {
        create: (req: unknown) => Promise<{
          content: Array<{ type: string; name?: string; input?: unknown }>;
        }>;
      };
    };

    const resp = await client.messages.create({
      model: this.modelName,
      max_tokens: 256,
      system: JUDGE_SYSTEM_PROMPT,
      tools: [
        {
          name: 'submit_verdict',
          description: 'Submit the prompt-injection classification verdict.',
          input_schema: JUDGE_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_verdict' },
      messages: [{ role: 'user', content: formatUserMessage(content, context) }],
    });

    const toolUse = resp.content.find(
      (block) => block.type === 'tool_use' && block.name === 'submit_verdict',
    );
    if (!toolUse || !toolUse.input) {
      throw new Error('anthropic judge: missing tool_use response');
    }
    return toolUse.input as JudgeOutput;
  }
}
