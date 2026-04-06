/**
 * LLM provider registry.
 * Manages the active LLM provider instance and provides a factory
 * for creating provider instances by name.
 */
import { LLMProvider, LLMProviderName } from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';

let activeProvider: LLMProvider | null = null;
let activeProviderName: LLMProviderName | null = null;

/** Creates an LLM provider instance for the given provider name and API key. */
export function createProvider(name: LLMProviderName, apiKey: string): LLMProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider(apiKey);
    case 'openai':
      return new OpenAIProvider(apiKey);
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}

/** Sets the active LLM provider used by the compiler and chat services. */
export function setActiveProvider(name: LLMProviderName, apiKey: string): void {
  activeProvider = createProvider(name, apiKey);
  activeProviderName = name;
}

export function getActiveProvider(): LLMProvider | null {
  return activeProvider;
}

export function getActiveProviderName(): LLMProviderName | null {
  return activeProviderName;
}

/** Clears the active provider (used during reset or provider switch). */
export function clearActiveProvider(): void {
  activeProvider = null;
  activeProviderName = null;
}
