import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _setClientForTesting,
  _resetClientForTesting,
  layer3Available,
  runLayer3,
  Layer3Timeout,
  Layer3Unavailable,
} from '../src/detection/layer3-judge.js';
import { createClientFromEnv } from '../src/detection/clients/factory.js';
import { AnthropicJudge } from '../src/detection/clients/anthropic.js';
import { OpenAICompatibleJudge } from '../src/detection/clients/openai-compatible.js';
import { OllamaJudge } from '../src/detection/clients/ollama-client.js';
import type {
  JudgeClient,
  JudgeContext,
  JudgeOutput,
} from '../src/detection/clients/types.js';

function fakeClient(
  judge: (content: string, context?: JudgeContext) => Promise<JudgeOutput>,
): JudgeClient & { calls: Array<{ content: string; context?: JudgeContext }> } {
  const calls: Array<{ content: string; context?: JudgeContext }> = [];
  return {
    providerName: 'fake',
    modelName: 'fake-model',
    calls,
    async judge(content, context) {
      calls.push({ content, context });
      return judge(content, context);
    },
  };
}

describe('layer3 judge', () => {
  afterEach(() => {
    _resetClientForTesting();
    delete process.env.VAULT_LAYER3_TIMEOUT_MS;
  });

  it('throws Layer3Unavailable when no client is configured', async () => {
    _setClientForTesting(null);
    expect(layer3Available()).toBe(false);
    await expect(runLayer3('some content')).rejects.toBeInstanceOf(Layer3Unavailable);
  });

  it('returns a malicious DetectionResult when the judge says malicious', async () => {
    _setClientForTesting(
      fakeClient(async () => ({
        verdict: 'malicious',
        confidence: 0.92,
        reasoning: 'detected role hijack',
        detected_patterns: ['role_hijack'],
      })),
    );
    const r = await runLayer3('payload', { toolName: 'read_file' });
    expect(r.verdict).toBe('malicious');
    expect(r.confidence).toBeCloseTo(0.92);
    expect(r.layer).toBe(3);
    expect(r.detectedPatterns).toEqual(['judge:role_hijack']);
    expect(r.reasoning).toMatch(/fake\/fake-model/);
  });

  it('returns clean for a clean judge verdict', async () => {
    _setClientForTesting(
      fakeClient(async () => ({
        verdict: 'clean',
        confidence: 0.95,
        reasoning: 'no injection',
        detected_patterns: [],
      })),
    );
    const r = await runLayer3('benign');
    expect(r.verdict).toBe('clean');
  });

  it('forwards JudgeContext to the client', async () => {
    const c = fakeClient(async () => ({
      verdict: 'clean',
      confidence: 0.9,
      reasoning: 'ok',
      detected_patterns: [],
    }));
    _setClientForTesting(c);
    await runLayer3('text', { toolName: 'read_file', mcpMethod: 'tools/call' });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]!.context).toEqual({ toolName: 'read_file', mcpMethod: 'tools/call' });
  });

  it('throws Layer3Timeout when the judge call exceeds the timeout', async () => {
    process.env.VAULT_LAYER3_TIMEOUT_MS = '50';
    _setClientForTesting(
      fakeClient(
        () =>
          new Promise<JudgeOutput>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  verdict: 'clean',
                  confidence: 0.9,
                  reasoning: 'ok',
                  detected_patterns: [],
                }),
              500,
            ),
          ),
      ),
    );
    await expect(runLayer3('payload')).rejects.toBeInstanceOf(Layer3Timeout);
  });

  it('normalizes malformed judge output', async () => {
    _setClientForTesting(
      fakeClient(async () => ({
        verdict: 'definitely_evil' as unknown as JudgeOutput['verdict'],
        confidence: 5 as unknown as number,
        reasoning: undefined as unknown as string,
        detected_patterns: [42, 'real'] as unknown as string[],
      })),
    );
    const r = await runLayer3('payload');
    expect(['clean', 'suspicious', 'malicious']).toContain(r.verdict);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.reasoning).toBeDefined();
    expect(r.detectedPatterns.every((p) => typeof p === 'string')).toBe(true);
  });
});

describe('layer3 factory', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OLLAMA_HOST: process.env.OLLAMA_HOST,
      VAULT_LAYER3_PROVIDER: process.env.VAULT_LAYER3_PROVIDER,
      VAULT_LAYER3_MODEL: process.env.VAULT_LAYER3_MODEL,
      VAULT_LAYER3_BASE_URL: process.env.VAULT_LAYER3_BASE_URL,
      VAULT_LAYER3_API_KEY: process.env.VAULT_LAYER3_API_KEY,
    };
    for (const k of Object.keys(saved)) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns null when no env is configured', () => {
    expect(createClientFromEnv()).toBeNull();
  });

  it('builds an AnthropicJudge from ANTHROPIC_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const c = createClientFromEnv();
    expect(c).toBeInstanceOf(AnthropicJudge);
    expect(c?.providerName).toBe('anthropic');
    expect(c?.modelName).toBe('claude-haiku-4-5-20251001');
  });

  it('builds an OpenAICompatibleJudge from OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const c = createClientFromEnv();
    expect(c).toBeInstanceOf(OpenAICompatibleJudge);
    expect(c?.providerName).toBe('openai');
    expect(c?.modelName).toBe('gpt-4o-mini');
  });

  it('respects VAULT_LAYER3_PROVIDER=custom with explicit settings', () => {
    process.env.VAULT_LAYER3_PROVIDER = 'custom';
    process.env.VAULT_LAYER3_API_KEY = 'local-key';
    process.env.VAULT_LAYER3_BASE_URL = 'http://localhost:8080/v1';
    process.env.VAULT_LAYER3_MODEL = 'llama-3.1-8b';
    const c = createClientFromEnv();
    expect(c).toBeInstanceOf(OpenAICompatibleJudge);
    expect(c?.providerName).toBe('custom');
    expect(c?.modelName).toBe('llama-3.1-8b');
  });

  it('returns null for custom provider without complete config', () => {
    process.env.VAULT_LAYER3_PROVIDER = 'custom';
    process.env.VAULT_LAYER3_API_KEY = 'local-key';
    // missing BASE_URL and MODEL
    expect(createClientFromEnv()).toBeNull();
  });

  it('VAULT_LAYER3_MODEL overrides the default model', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.VAULT_LAYER3_MODEL = 'claude-opus-4-7';
    const c = createClientFromEnv();
    expect(c?.modelName).toBe('claude-opus-4-7');
  });

  it('builds an OllamaJudge from OLLAMA_HOST', () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    const c = createClientFromEnv();
    expect(c).toBeInstanceOf(OllamaJudge);
    expect(c?.providerName).toBe('ollama');
    expect(c?.modelName).toBe('llama3.2:3b');
  });

  it('builds an OllamaJudge from VAULT_LAYER3_PROVIDER=ollama without OLLAMA_HOST', () => {
    process.env.VAULT_LAYER3_PROVIDER = 'ollama';
    const c = createClientFromEnv();
    expect(c).toBeInstanceOf(OllamaJudge);
    expect(c?.providerName).toBe('ollama');
  });

  it('respects VAULT_LAYER3_MODEL and VAULT_LAYER3_BASE_URL for ollama', () => {
    process.env.VAULT_LAYER3_PROVIDER = 'ollama';
    process.env.VAULT_LAYER3_MODEL = 'mistral:7b';
    process.env.VAULT_LAYER3_BASE_URL = 'http://gpu-box:11434';
    const c = createClientFromEnv();
    expect(c).toBeInstanceOf(OllamaJudge);
    expect(c?.modelName).toBe('mistral:7b');
  });

  it('prefers ANTHROPIC over OLLAMA_HOST when explicit provider not set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    const c = createClientFromEnv();
    expect(c).toBeInstanceOf(AnthropicJudge);
  });
});
