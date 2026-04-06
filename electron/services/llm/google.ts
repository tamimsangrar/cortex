/**
 * Google Gemini LLM provider (optional).
 * Not wired into the provider registry — available for future integration.
 * To enable: add 'google' to LLMProviderName and register in createProvider().
 */
// Note: The @google/generative-ai SDK passes the API key as a URL query parameter
// internally. This is Google's standard approach and cannot be changed without switching
// SDKs. The key is only sent over HTTPS to Google's API endpoints.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ChatMessage, ChatOptions, ChatResponse, LLMProvider } from './types';

// Privacy: Google Gemini API data retention varies by pricing tier (free vs. paid).
// Free-tier requests may be used for product improvement. Review Google's data policy:
// https://ai.google.dev/terms

export class GoogleProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const modelId = options?.model ?? 'gemini-2.0-flash';
    const model = this.genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature,
      },
    });

    // Extract system instruction and build chat history
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    const systemInstruction = systemMessages.map(m => m.content).join('\n\n') || undefined;

    // Build history (all messages except the last user message)
    const history = nonSystemMessages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }));

    const lastMessage = nonSystemMessages[nonSystemMessages.length - 1];

    const chat = model.startChat({
      history,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    const result = await chat.sendMessage(lastMessage?.content ?? '');
    const response = result.response;
    const usageMetadata = response.usageMetadata;

    return {
      content: response.text(),
      usage: {
        inputTokens: usageMetadata?.promptTokenCount ?? 0,
        outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: modelId,
    };
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
