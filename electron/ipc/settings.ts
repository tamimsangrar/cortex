/**
 * IPC handlers for settings, API keys, MCP server, GitHub OAuth, and data management.
 */
import { ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { getCortexDataDir } from '../main';
import { saveApiKey, loadApiKey, hasApiKey } from '../services/keystore';
import { createProvider } from '../services/llm';
import { PROVIDER_MODELS, LLMProviderName } from '../services/llm/types';
import { startDeviceFlow, pollForToken } from '../services/auth/github-oauth';
import { fetchModels } from '../services/llm/model-registry';

let mcpProcess: ChildProcess | null = null;
let mcpPort: number = 3939;

function getConfigPath(): string {
  return path.join(getCortexDataDir(), 'config.json');
}

function readConfig(): Record<string, unknown> {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return {};
}

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get-provider', async () => {
    const config = readConfig();
    return {
      provider: (config.llmProvider as string) ?? null,
      model: (config.llmModel as string) ?? null,
      fastModel: (config.llmFastModel as string) ?? null,
    };
  });

  ipcMain.handle('settings:set-provider', async (_, provider: string, model: string, fastModel?: string) => {
    const config = readConfig();
    config.llmProvider = provider;

    // Apply smart defaults if no model specified
    const WRITE_DEFAULTS: Record<string, string> = {
      anthropic: 'claude-sonnet-4-6',
      openai: 'gpt-4.1',
    };
    const FAST_DEFAULTS: Record<string, string> = {
      anthropic: 'claude-haiku-4-5',
      openai: 'gpt-4.1-nano',
    };

    config.llmModel = model || WRITE_DEFAULTS[provider] || model;
    config.llmFastModel = (fastModel !== undefined ? fastModel : null)
      || (config.llmFastModel as string)
      || FAST_DEFAULTS[provider]
      || config.llmModel;

    writeConfig(config);
  });

  ipcMain.handle('settings:set-api-key', async (_, provider: string, key: string) => {
    try {
      saveApiKey(provider, key);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save API key';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('settings:has-api-key', async (_, provider: string) => {
    return hasApiKey(provider);
  });

  ipcMain.handle('settings:test-connection', async () => {
    const config = readConfig();
    const providerName = config.llmProvider as LLMProviderName | undefined;
    const model = config.llmModel as string | undefined;

    if (!providerName) {
      return { success: false, error: 'No LLM provider configured' };
    }

    const apiKey = loadApiKey(providerName);
    if (!apiKey) {
      return { success: false, error: `No API key set for ${providerName}` };
    }

    try {
      const provider = createProvider(providerName, apiKey);
      return await provider.testConnection();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection test failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('settings:get-models', async (_, provider: string) => {
    const name = provider as LLMProviderName;
    return PROVIDER_MODELS[name] ?? [];
  });

  // Dynamic model fetching
  ipcMain.handle('settings:fetch-models', async (_, provider: string) => {
    const name = provider as LLMProviderName;
    const apiKey = loadApiKey(name);
    if (!apiKey) {
      return PROVIDER_MODELS[name]?.map(m => ({ ...m, provider: name })) ?? [];
    }
    try {
      return await fetchModels(name, apiKey);
    } catch {
      return PROVIDER_MODELS[name]?.map(m => ({ ...m, provider: name })) ?? [];
    }
  });

  // GitHub OAuth Device Flow
  ipcMain.handle('auth:github:start-device-flow', async () => {
    try {
      const deviceCodeResp = await startDeviceFlow();
      shell.openExternal(deviceCodeResp.verification_uri);
      return {
        success: true,
        userCode: deviceCodeResp.user_code,
        verificationUri: deviceCodeResp.verification_uri,
        deviceCode: deviceCodeResp.device_code,
        interval: deviceCodeResp.interval,
        expiresIn: deviceCodeResp.expires_in,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start device flow';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('auth:github:poll-token', async (_, deviceCode: string, interval: number) => {
    try {
      const token = await pollForToken(deviceCode, interval);
      saveApiKey('github', token);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authorization failed';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('auth:github:status', async () => {
    return { hasToken: hasApiKey('github') };
  });

  // Auto-detect gh CLI token
  ipcMain.handle('auth:github:detect-cli-token', async () => {
    const { GitHubModelsProvider } = await import('../services/llm/github');
    const token = GitHubModelsProvider.getTokenFromCLI();
    if (token) {
      saveApiKey('github', token);
      return { success: true, tokenPrefix: token.slice(0, 7) + '...' };
    }
    return { success: false, error: 'GitHub CLI not found or not authenticated. Run "gh auth login" first.' };
  });

  // MCP Server management
  ipcMain.handle('mcp:start', async () => {
    if (mcpProcess && !mcpProcess.killed) {
      return { running: true, port: mcpPort, pid: mcpProcess.pid };
    }

    const projectRoot = path.resolve(__dirname, '..');
    const serverScript = path.join(projectRoot, 'mcp', 'http-server.ts');

    try {
      mcpProcess = spawn('npx', ['tsx', serverScript], {
        cwd: projectRoot,
        env: { ...process.env, MCP_PORT: String(mcpPort) },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      return await new Promise<{ running: boolean; port: number; pid?: number; error?: string }>((resolve) => {
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({ running: true, port: mcpPort, pid: mcpProcess?.pid });
          }
        }, 3000);

        mcpProcess!.stdout?.on('data', (data: Buffer) => {
          const msg = data.toString();
          if (msg.includes('listening') && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve({ running: true, port: mcpPort, pid: mcpProcess?.pid });
          }
        });

        mcpProcess!.stderr?.on('data', () => {});

        mcpProcess!.on('error', (err: Error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            mcpProcess = null;
            resolve({ running: false, port: mcpPort, error: err.message });
          }
        });

        mcpProcess!.on('exit', (code: number | null) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            mcpProcess = null;
            resolve({ running: false, port: mcpPort, error: `Process exited with code ${code}` });
          } else {
            mcpProcess = null;
          }
        });
      });
    } catch (err: unknown) {
      mcpProcess = null;
      const message = err instanceof Error ? err.message : 'Failed to start MCP server';
      return { running: false, port: mcpPort, error: message };
    }
  });

  ipcMain.handle('mcp:stop', async () => {
    if (mcpProcess && !mcpProcess.killed) {
      mcpProcess.kill();
      mcpProcess = null;
    }
    return { running: false };
  });

  ipcMain.handle('mcp:status', async () => {
    const running = mcpProcess !== null && !mcpProcess.killed;
    return { running, port: running ? mcpPort : undefined };
  });

  // User profile
  ipcMain.handle('app:get-user-profile', async () => {
    const config = readConfig();
    const profile = (config.userProfile as { name?: string; nicknames?: string[] }) || {};
    return { name: profile.name || '', nicknames: profile.nicknames || [] };
  });

  // Activity logs — reads absorb log and _log.md
  ipcMain.handle('app:get-logs', async () => {
    const base = getCortexDataDir();
    const wikiDir = path.join(base, 'wiki');

    // Read absorb log
    const absorbLogPath = path.join(wikiDir, '_absorb_log.json');
    let absorbLog: { entryId: string; absorbedAt: string; articlesCreated: string[]; articlesUpdated: string[]; tokensUsed: { input: number; output: number } }[] = [];
    try {
      if (fs.existsSync(absorbLogPath)) {
        absorbLog = JSON.parse(fs.readFileSync(absorbLogPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    // Compute stats
    const totalTokensIn = absorbLog.reduce((s, e) => s + (e.tokensUsed?.input || 0), 0);
    const totalTokensOut = absorbLog.reduce((s, e) => s + (e.tokensUsed?.output || 0), 0);
    const totalCreated = absorbLog.reduce((s, e) => s + (e.articlesCreated?.length || 0), 0);
    const totalUpdated = absorbLog.reduce((s, e) => s + (e.articlesUpdated?.length || 0), 0);
    const skipped = absorbLog.filter(e => !e.articlesCreated?.length && !e.articlesUpdated?.length).length;

    // Return recent entries (most recent first, capped at 200)
    const recentEntries = absorbLog.slice(-200).reverse().map(e => ({
      entryId: e.entryId,
      timestamp: e.absorbedAt,
      articlesCreated: e.articlesCreated || [],
      articlesUpdated: e.articlesUpdated || [],
      tokensIn: e.tokensUsed?.input || 0,
      tokensOut: e.tokensUsed?.output || 0,
    }));

    return {
      stats: {
        totalEntries: absorbLog.length,
        totalCreated,
        totalUpdated,
        skipped,
        totalTokensIn,
        totalTokensOut,
      },
      entries: recentEntries,
    };
  });

  // Nuke all data
  ipcMain.handle('app:nuke-all', async () => {
    const base = getCortexDataDir();
    let deletedEntries = 0;
    let deletedArticles = 0;
    let deletedChats = 0;

    function rmDirContents(dir: string): number {
      if (!fs.existsSync(dir)) return 0;
      let count = 0;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          count += rmDirContents(full);
          fs.rmdirSync(full);
        } else {
          fs.unlinkSync(full);
          count++;
        }
      }
      return count;
    }

    // 1. Delete all entries
    const entriesDir = path.join(base, 'raw', 'entries');
    deletedEntries = rmDirContents(entriesDir);

    // 2. Delete all wiki contents (schema will be regenerated on next compile)
    const wikiDir = path.join(base, 'wiki');
    if (fs.existsSync(wikiDir)) {
      deletedArticles = rmDirContents(wikiDir);
    }

    // 3. Delete all chats
    const chatsDir = path.join(base, 'chats');
    deletedChats = rmDirContents(chatsDir);

    // 4. Delete data subdirectory contents
    const dataDir = path.join(base, 'data');
    if (fs.existsSync(dataDir)) {
      for (const name of fs.readdirSync(dataDir)) {
        const full = path.join(dataDir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          rmDirContents(full);
        } else {
          fs.unlinkSync(full);
        }
      }
    }

    // 5. Reset config.json — only keep API keys and provider
    const config = readConfig();
    const resetConfig: Record<string, unknown> = {};
    if (config.llmProvider) resetConfig.llmProvider = config.llmProvider;
    if (config.llmModel) resetConfig.llmModel = config.llmModel;
    if (config.llmFastModel) resetConfig.llmFastModel = config.llmFastModel;
    writeConfig(resetConfig);

    return { success: true, deletedEntries, deletedArticles, deletedChats };
  });
}
