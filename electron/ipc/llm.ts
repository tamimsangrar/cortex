/**
 * IPC handler for direct LLM chat calls from the renderer.
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getCortexDataDir } from '../main';
import { loadApiKey } from '../services/keystore';
import { createProvider } from '../services/llm';
import { ChatMessage, ChatOptions, LLMProviderName } from '../services/llm/types';

export function registerLlmHandlers(): void {
  ipcMain.handle('llm:chat', async (_, messages: ChatMessage[], options?: ChatOptions) => {
    const configPath = path.join(getCortexDataDir(), 'config.json');
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    const providerName = config.llmProvider as LLMProviderName | undefined;
    if (!providerName) {
      throw new Error('No LLM provider configured. Go to Settings to set one up.');
    }

    const apiKey = loadApiKey(providerName);
    if (!apiKey) {
      throw new Error(`No API key set for ${providerName}. Go to Settings to add your key.`);
    }

    const model = (config.llmModel as string) ?? undefined;
    const provider = createProvider(providerName, apiKey);

    return await provider.chat(messages, {
      ...options,
      model: options?.model ?? model,
    });
  });
}
