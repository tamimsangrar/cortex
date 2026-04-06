/**
 * GitHub Models LLM provider (optional).
 * Not wired into the provider registry — available for future integration.
 * Uses the OpenAI-compatible Azure inference endpoint with a GitHub PAT.
 * To enable: add 'github' to LLMProviderName and register in createProvider().
 */
import OpenAI from 'openai';
import { LLMProvider, ChatMessage, ChatOptions, ChatResponse } from './types';
import { execSync } from 'child_process';

export class GitHubModelsProvider implements LLMProvider {
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({
      baseURL: 'https://models.inference.ai.azure.com',
      apiKey: apiKey,
    });
    this.defaultModel = model || 'gpt-4o-mini';
  }

  // Try to get token from gh CLI automatically
  static getTokenFromCLI(): string | null {
    try {
      const token = execSync('gh auth token 2>/dev/null', { encoding: 'utf-8' }).trim();
      return token || null;
    } catch {
      return null;
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || this.defaultModel,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
      });

      const choice = response.choices[0];
      return {
        content: choice?.message?.content || '',
        usage: {
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
        },
        model: response.model,
      };
    } catch (err: unknown) {
      const status = (err as Record<string, unknown>)?.status ??
                     ((err as Record<string, Record<string, unknown>>)?.response)?.status;
      if (status === 429) throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      if (status === 402 || status === 403) throw new Error('API credits exhausted or access denied. Check your plan and billing.');
      if (status === 503) throw new Error('Service temporarily overloaded. Try again in a few seconds.');
      throw err;
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.chat([{ role: 'user', content: 'Hello' }], { maxTokens: 10 });
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      return { success: false, error: message };
    }
  }
}
