import { AnthropicJudge } from './anthropic.js';
import { OpenAICompatibleJudge } from './openai-compatible.js';
import type { JudgeClient } from './types.js';

const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

export function createClientFromEnv(): JudgeClient | null {
  const provider = process.env.VAULT_LAYER3_PROVIDER?.toLowerCase();
  const explicitModel = process.env.VAULT_LAYER3_MODEL;
  const explicitBaseUrl = process.env.VAULT_LAYER3_BASE_URL;
  const explicitApiKey = process.env.VAULT_LAYER3_API_KEY;

  if (provider === 'anthropic' || (!provider && process.env.ANTHROPIC_API_KEY)) {
    const apiKey = explicitApiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return new AnthropicJudge({ apiKey, model: explicitModel ?? DEFAULT_ANTHROPIC_MODEL });
  }

  if (provider === 'openai' || (!provider && process.env.OPENAI_API_KEY)) {
    const apiKey = explicitApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    return new OpenAICompatibleJudge({
      apiKey,
      model: explicitModel ?? DEFAULT_OPENAI_MODEL,
      baseUrl: explicitBaseUrl ?? DEFAULT_OPENAI_BASE,
      providerName: 'openai',
    });
  }

  if (provider === 'custom') {
    if (!explicitApiKey || !explicitBaseUrl || !explicitModel) return null;
    return new OpenAICompatibleJudge({
      apiKey: explicitApiKey,
      model: explicitModel,
      baseUrl: explicitBaseUrl,
      providerName: 'custom',
    });
  }

  return null;
}
