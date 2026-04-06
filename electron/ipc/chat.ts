/**
 * IPC handlers for the RAG chat service.
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { setActiveProvider, getActiveProvider } from '../services/llm';
import { LLMProviderName } from '../services/llm/types';
import { loadApiKey } from '../services/keystore';
import { getCortexDataDir } from '../main';
import {
  query,
  fileAnswer,
  listChats,
  getChat,
  deleteChat,
  createChat,
  saveChat,
  ChatMessage,
} from '../services/chat';
import fs from 'fs';
import path from 'path';

function ensureProviderLoaded(): void {
  if (getActiveProvider()) return;

  const configPath = path.join(getCortexDataDir(), 'config.json');
  if (!fs.existsSync(configPath)) throw new Error('No config found. Set up your LLM provider in Settings.');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const providerName = config.llmProvider as LLMProviderName | undefined;
  if (!providerName) throw new Error('No LLM provider configured. Go to Settings first.');

  const apiKey = loadApiKey(providerName);
  if (!apiKey) throw new Error(`No API key found for ${providerName}. Go to Settings and save your key.`);

  setActiveProvider(providerName, apiKey);
}

export function registerChatHandlers(): void {
  ipcMain.handle('chat:new', async () => {
    return createChat();
  });

  ipcMain.handle('chat:send', async (event: IpcMainInvokeEvent, chatId: string, message: string, history: ChatMessage[]) => {
    try {
      ensureProviderLoaded();
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    }

    const provider = getActiveProvider();
    if (!provider) return { error: 'No LLM provider available.' };

    // Load or create session
    let session = getChat(chatId);
    if (!session) {
      return { error: `Chat session not found: ${chatId}` };
    }

    // Add user message
    const userMsg: ChatMessage = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMsg);

    // Auto-generate title from first user message
    if (session.title === 'New Chat') {
      session.title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
    }

    // Emit thinking steps
    const onThinking = (step: string) => {
      try {
        event.sender.send('chat:thinking', step);
      } catch {
        // Renderer may have been destroyed
      }
    };

    try {
      const result = await query(provider, message, history || session.messages, onThinking);

      // Add assistant message
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.content,
        sources: result.sources,
        timestamp: new Date().toISOString(),
      };
      session.messages.push(assistantMsg);

      // Persist
      saveChat(session);

      return {
        content: result.content,
        sources: result.sources,
        chatId: session.id,
      };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to get response from LLM.' };
    }
  });

  ipcMain.handle('chat:file-answer', async (_event: IpcMainInvokeEvent, answer: string, chatId: string) => {
    try {
      ensureProviderLoaded();
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    }

    const provider = getActiveProvider();
    if (!provider) return { error: 'No LLM provider available.' };

    const session = getChat(chatId);
    if (!session) return { error: `Chat session not found: ${chatId}` };

    try {
      const createdPath = await fileAnswer(provider, answer, session);
      return { path: createdPath };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to file answer into wiki.' };
    }
  });

  ipcMain.handle('chat:list', async () => {
    return listChats();
  });

  ipcMain.handle('chat:get', async (_event: IpcMainInvokeEvent, id: string) => {
    const session = getChat(id);
    if (!session) return { error: `Chat not found: ${id}` };
    return session;
  });

  ipcMain.handle('chat:delete', async (_event: IpcMainInvokeEvent, id: string) => {
    const deleted = deleteChat(id);
    return { success: deleted };
  });
}
