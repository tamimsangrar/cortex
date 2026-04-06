// Privacy: OpenAI does NOT use API data for model training by default (since March 2023).
// See: https://openai.com/policies/api-data-usage-policies
import OpenAI from 'openai';
import { ChatMessage, ChatOptions, ChatResponse, LLMProvider } from './types';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options?.model ?? 'gpt-4.1',
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      });

      const choice = response.choices[0];

      return {
        content: choice?.message?.content ?? '',
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        model: response.model,
      };
    } catch (err: unknown) {
      const errObj = err as Record<string, unknown>;
      const status = errObj?.status ?? (errObj?.response as Record<string, unknown>)?.status;
      if (status === 429) throw new Error('OpenAI rate limit exceeded. Wait a moment and try again, or check your usage at platform.openai.com/usage.');
      if (status === 401) throw new Error('Invalid OpenAI API key. Check your key at platform.openai.com/api-keys.');
      if (status === 402 || ((errObj as Record<string, unknown>)?.code === 'insufficient_quota')) throw new Error('OpenAI credits exhausted. Add billing at platform.openai.com/settings/billing.');
      if (status === 503) throw new Error('OpenAI service overloaded. Try again in a few seconds.');
      throw err;
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.chat([{ role: 'user', content: 'Hello' }], { maxTokens: 16 });
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }
}
