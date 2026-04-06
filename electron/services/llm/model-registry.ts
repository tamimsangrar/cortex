/**
 * Model registry — fetches available models from provider APIs.
 * Falls back to the static PROVIDER_MODELS catalog on API errors.
 */
import { LLMProviderName, PROVIDER_MODELS } from './types';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export async function fetchModels(provider: LLMProviderName, apiKey: string): Promise<ModelInfo[]> {
  switch (provider) {
    case 'openai':
      return fetchOpenAIModels(apiKey);
    case 'anthropic':
      return getAnthropicModels();
  }
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
    const data = await resp.json() as { data: { id: string }[] };
    return data.data
      .filter((m) => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3') || m.id.includes('o4'))
      .map((m) => ({ id: m.id, name: m.id, provider: 'openai' }))
      .sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name));
  } catch {
    return PROVIDER_MODELS.openai.map(m => ({ ...m, provider: 'openai' }));
  }
}

function getAnthropicModels(): ModelInfo[] {
  return PROVIDER_MODELS.anthropic.map(m => ({ ...m, provider: 'anthropic' }));
}
