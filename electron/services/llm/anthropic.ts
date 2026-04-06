// Privacy: Anthropic does NOT use API data for model training.
// See: https://www.anthropic.com/privacy
import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage, ChatOptions, ChatResponse, LLMProvider } from './types';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    try {
      const systemMessages = messages.filter(m => m.role === 'system');
      const nonSystemMessages = messages.filter(m => m.role !== 'system');

      const response = await this.client.messages.create({
        model: options?.model ?? 'claude-sonnet-4-6',
        max_tokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature,
        system: systemMessages.map(m => m.content).join('\n\n') || undefined,
        messages: nonSystemMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      const textBlock = response.content.find(b => b.type === 'text');

      return {
        content: textBlock?.text ?? '',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        model: response.model,
      };
    } catch (err: unknown) {
      const status = (err as Record<string, unknown>)?.status ??
                     ((err as Record<string, Record<string, unknown>>)?.error)?.status;
      if (status === 429) throw new Error('Anthropic rate limit exceeded. Wait a moment and try again, or upgrade your plan at console.anthropic.com.');
      if (status === 401) throw new Error('Invalid Anthropic API key. Check your key at console.anthropic.com.');
      if (status === 403) throw new Error('API access denied. Your Anthropic account may need billing set up at console.anthropic.com/settings/billing.');
      if (status === 529) throw new Error('Anthropic API is overloaded. Try again in a few seconds.');
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
