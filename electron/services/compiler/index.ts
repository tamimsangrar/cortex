/**
 * Compiler service — absorbs raw entries into the personal wiki.
 * For each unprocessed entry: asks the LLM for a plan (which articles to
 * create/update), executes the plan, and logs results.
 */
import fs from 'fs';
import path from 'path';
import { getCortexDataDir } from '../../main';
import { getActiveProvider } from '../llm';
import { LLMProvider, ChatResponse } from '../llm/types';
import { ensureSchema, loadSchema } from './schema';
import { planPrompt, batchPlanPrompt, updatePrompt, createPrompt } from './prompts';
import { rebuildIndex, rebuildBacklinks, appendLog } from './indexer';

/** Number of entries to process in a single plan call */
const BATCH_SIZE = 5;
/** Max concurrent LLM calls for updates/creates within a batch */
const LLM_CONCURRENCY = 3;
/** Minimum meaningful body characters for an entry to be worth compiling */
const MIN_ENTRY_CHARS = 200;

/** Run async tasks with a concurrency limit, returning settled results */
async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      try {
        const value = await tasks[idx]();
        results[idx] = { status: 'fulfilled', value };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// Lightweight checkpoint audit (no LLM calls)
function runCheckpointAudit(wikiDir: string, absorbLog: AbsorbLogEntry[]): string[] {
  const auditMessages: string[] = [];

  // 1. Count new articles created in last 15 entries
  const last15 = absorbLog.slice(-15);
  const newArticles = last15.reduce((sum, e) => sum + e.articlesCreated.length, 0);
  if (newArticles === 0) {
    auditMessages.push('CRAMMING DETECTED: Zero new articles in last 15 entries. Consider whether subtopics deserve their own pages.');
  }

  // 2. Find the 3 most-updated articles in last 15 entries
  const updateCounts = new Map<string, number>();
  for (const entry of last15) {
    for (const art of entry.articlesUpdated) {
      updateCounts.set(art, (updateCounts.get(art) || 0) + 1);
    }
  }
  const topUpdated = Array.from(updateCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [articlePath] of topUpdated) {
    const fullPath = path.join(wikiDir, articlePath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const fmEndIdx = lines.indexOf('---', 1);
    const bodyLines = fmEndIdx >= 0 ? lines.slice(fmEndIdx + 1) : lines;
    const headings = bodyLines.filter(l => /^##\s+/.test(l));

    // Check for diary-driven structure (date-based headings)
    const dateHeadingPattern = /^##\s+(?:(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d|(?:the\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:20\d{2})|(?:q[1-4]\s+20))/i;
    const dateHeadingCount = headings.filter(h => dateHeadingPattern.test(h)).length;
    if (headings.length >= 2 && dateHeadingCount / headings.length > 0.5) {
      auditMessages.push(`DIARY-DRIVEN: ${articlePath} has chronological section headings. Restructure around themes.`);
    }

    // Check quote density
    const bodyContent = bodyLines.join('\n');
    const quoteBlocks = (bodyContent.match(/^>\s+.+$/gm) || []).length;
    const inlineQuotes = (bodyContent.match(/"[^"]{10,}"/g) || []).length;
    if (quoteBlocks + inlineQuotes > 2) {
      auditMessages.push(`QUOTE DENSITY: ${articlePath} has ${quoteBlocks + inlineQuotes} quotes (max 2). Keep only the strongest.`);
    }

    // Check line count
    const nonEmptyBodyLines = bodyLines.filter(l => l.trim()).length;
    if (nonEmptyBodyLines > 120) {
      auditMessages.push(`BLOATED: ${articlePath} has ${nonEmptyBodyLines} lines. Consider splitting.`);
    }
  }

  return auditMessages;
}

function loadConfigModel(): string | undefined {
  try {
    const configPath = path.join(getCortexDataDir(), 'config.json');
    if (!fs.existsSync(configPath)) return undefined;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return (config.llmModel as string) || undefined;
  } catch {
    return undefined;
  }
}

/** Load the fast/cheap model used for planning & triage. Falls back to main model. */
function loadConfigFastModel(): string | undefined {
  try {
    const configPath = path.join(getCortexDataDir(), 'config.json');
    if (!fs.existsSync(configPath)) return undefined;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return (config.llmFastModel as string) || (config.llmModel as string) || undefined;
  } catch {
    return undefined;
  }
}

/** Extract body content length (after frontmatter, headings, chat metadata) */
function extractBodyLength(content: string): number {
  const fmStart = content.indexOf('---');
  const fmEnd = fmStart >= 0 ? content.indexOf('---', fmStart + 3) : -1;
  const body = fmEnd >= 0 ? content.slice(fmEnd + 3) : content;
  const cleaned = body
    .split('\n')
    .filter(l => !l.startsWith('#') && l.trim())
    .join('\n')
    .replace(/\*\*[^*]+\*\*\s*\([^)]+\):\s*/g, '') // strip **Sender** (time):
    .replace(/\[Media omitted\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length;
}

/** Extract a frontmatter field value */
function extractFmField(content: string, field: string): string {
  const match = content.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?`, 'm'));
  return match ? match[1].trim() : '';
}

/**
 * Sort entries so same-contact, same-source entries are adjacent.
 * This maximizes batch plan quality — the LLM sees related entries together.
 */
function smartSortEntries(
  entries: { file: string; content: string; id: string; title: string }[],
): { file: string; content: string; id: string; title: string }[] {
  return entries.sort((a, b) => {
    const sourceA = extractFmField(a.content, 'source_type');
    const sourceB = extractFmField(b.content, 'source_type');
    if (sourceA !== sourceB) return sourceA.localeCompare(sourceB);

    const contactA = extractFmField(a.content, 'contact_name');
    const contactB = extractFmField(b.content, 'contact_name');
    if (contactA !== contactB) return contactA.localeCompare(contactB);

    return a.file.localeCompare(b.file);
  });
}

export interface CompilerState {
  status: 'idle' | 'running' | 'paused' | 'error';
  currentEntry: string | null;
  entriesProcessed: number;
  entriesTotal: number;
  articlesCreated: number;
  articlesUpdated: number;
  tokensUsed: { input: number; output: number };
}

interface AbsorbLogEntry {
  entryId: string;
  absorbedAt: string;
  articlesCreated: string[];
  articlesUpdated: string[];
  tokensUsed: { input: number; output: number };
}

interface PlanAction {
  path: string;
  reason: string;
}

interface PlanCreate extends PlanAction {
  title: string;
}

interface Plan {
  analysis: string;
  updates: PlanAction[];
  creates: PlanCreate[];
}

function stripJsonFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```json')) {
    s = s.slice(7);
  } else if (s.startsWith('```')) {
    s = s.slice(3);
  }
  if (s.endsWith('```')) {
    s = s.slice(0, -3);
  }
  return s.trim();
}

function parseEntryTitle(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('# ')) {
      return line.slice(2).trim();
    }
  }
  return 'Unknown entry';
}

function parseEntryId(content: string): string {
  const match = content.match(/^id:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

function loadAbsorbLog(wikiDir: string): AbsorbLogEntry[] {
  const logPath = path.join(wikiDir, '_absorb_log.json');
  if (!fs.existsSync(logPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(logPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAbsorbLog(wikiDir: string, log: AbsorbLogEntry[]): void {
  const logPath = path.join(wikiDir, '_absorb_log.json');
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
}

function loadIndex(wikiDir: string): string {
  const indexPath = path.join(wikiDir, '_index.md');
  if (!fs.existsSync(indexPath)) return '';
  return fs.readFileSync(indexPath, 'utf-8');
}

function accumulateTokens(
  state: CompilerState,
  response: ChatResponse,
): void {
  state.tokensUsed.input += response.usage.inputTokens;
  state.tokensUsed.output += response.usage.outputTokens;
}

export class Compiler {
  private state: CompilerState = {
    status: 'idle',
    currentEntry: null,
    entriesProcessed: 0,
    entriesTotal: 0,
    articlesCreated: 0,
    articlesUpdated: 0,
    tokensUsed: { input: 0, output: 0 },
  };

  private onProgress?: (state: CompilerState) => void;
  private shouldStop = false;
  private shouldPause = false;

  async start(onProgress: (state: CompilerState) => void, sourceType?: string): Promise<void> {
    const provider = getActiveProvider();
    if (!provider) {
      throw new Error(
        'No LLM provider configured. Go to Settings and set up an API key first.',
      );
    }

    this.onProgress = onProgress;
    this.shouldStop = false;
    this.shouldPause = false;

    const baseDir = getCortexDataDir();
    const wikiDir = path.join(baseDir, 'wiki');
    const entriesDir = path.join(baseDir, 'raw', 'entries');

    this.state = {
      status: 'running',
      currentEntry: null,
      entriesProcessed: 0,
      entriesTotal: 0,
      articlesCreated: 0,
      articlesUpdated: 0,
      tokensUsed: { input: 0, output: 0 },
    };

    try {
      // Step 1: Ensure schema exists
      ensureSchema(wikiDir);

      // Step 2: Load absorb log to find already-processed entries
      const absorbLog = loadAbsorbLog(wikiDir);
      const processedIds = new Set(absorbLog.map((e) => e.entryId));

      // Step 3: Scan for unprocessed entries, sort chronologically
      if (!fs.existsSync(entriesDir)) {
        this.state.status = 'idle';
        this.emitProgress();
        return;
      }

      const allFiles = fs.readdirSync(entriesDir).filter((f) => f.endsWith('.md')).sort();
      const unprocessedFiles: string[] = [];

      // Load excludes list from config
      let excludedIds = new Set<string>();
      try {
        const configPath = path.join(baseDir, 'config.json');
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (Array.isArray(config.compilationExcludes)) {
            excludedIds = new Set(config.compilationExcludes);
          }
        }
      } catch {
        // ignore config read errors
      }

      for (const file of allFiles) {
        const content = fs.readFileSync(path.join(entriesDir, file), 'utf-8');
        const entryId = parseEntryId(content);
        const effectiveId = entryId || file.replace('.md', '');

        // Skip entries that are excluded from compilation
        if (excludedIds.has(effectiveId)) continue;

        // Filter by source type if specified
        if (sourceType) {
          const sourcePrefix = sourceType === 'web-clip' ? 'clip' : sourceType === 'apple-notes' ? 'note' : sourceType;
          if (!effectiveId.startsWith(sourcePrefix + '_') && !file.includes('_' + sourcePrefix.slice(0, 2) + '_')) continue;
        }

        if (entryId && !processedIds.has(entryId)) {
          unprocessedFiles.push(file);
        } else if (!entryId) {
          if (!processedIds.has(effectiveId)) {
            unprocessedFiles.push(file);
          }
        }
      }

      this.state.entriesTotal = unprocessedFiles.length;
      this.emitProgress();

      if (unprocessedFiles.length === 0) {
        this.state.status = 'idle';
        this.emitProgress();
        return;
      }

      // Pre-read all entry data into memory
      const rawEntryData = unprocessedFiles.map((file) => {
        const content = fs.readFileSync(path.join(entriesDir, file), 'utf-8');
        return {
          file,
          content,
          id: parseEntryId(content) || file.replace('.md', ''),
          title: parseEntryTitle(content),
        };
      });

      // Pre-filter: skip trivially short entries (mark them absorbed so they don't retry)
      const trivialIds: string[] = [];
      const substantiveEntries = rawEntryData.filter((entry) => {
        if (extractBodyLength(entry.content) < MIN_ENTRY_CHARS) {
          trivialIds.push(entry.id);
          return false;
        }
        return true;
      });

      // Log trivial entries as absorbed with no articles
      if (trivialIds.length > 0) {
        for (const id of trivialIds) {
          absorbLog.push({
            entryId: id,
            absorbedAt: new Date().toISOString(),
            articlesCreated: [],
            articlesUpdated: [],
            tokensUsed: { input: 0, output: 0 },
          });
        }
        saveAbsorbLog(wikiDir, absorbLog);
        console.log(`[Compiler] Skipped ${trivialIds.length} trivial entries (< ${MIN_ENTRY_CHARS} chars)`);
      }

      // Smart sort: group same-contact, same-source entries adjacent for better batching
      const entryData = smartSortEntries(substantiveEntries);

      this.state.entriesTotal = entryData.length;
      this.emitProgress();

      if (entryData.length === 0) {
        this.state.status = 'idle';
        this.emitProgress();
        return;
      }

      // Step 4: Process entries in batches
      for (let batchStart = 0; batchStart < entryData.length; batchStart += BATCH_SIZE) {
        if (this.shouldStop) {
          this.state.status = 'idle';
          this.emitProgress();
          return;
        }

        while (this.shouldPause) {
          this.state.status = 'paused';
          this.emitProgress();
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (this.shouldStop) {
            this.state.status = 'idle';
            this.emitProgress();
            return;
          }
        }

        const batchEnd = Math.min(batchStart + BATCH_SIZE, entryData.length);
        const batch = entryData.slice(batchStart, batchEnd);

        this.state.status = 'running';
        this.state.currentEntry = batch.length === 1
          ? batch[0].file
          : `${batch[0].file} + ${batch.length - 1} more`;
        this.emitProgress();

        try {
          await this.absorbBatch(provider, wikiDir, batch, absorbLog);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error absorbing batch starting at ${batch[0].file}:`, msg);

          if (
            msg.includes('rate_limit') || msg.includes('Rate limit') ||
            msg.includes('429') || msg.includes('quota') ||
            msg.includes('insufficient_quota') || msg.includes('billing') ||
            msg.includes('credit') || msg.includes('exceeded') ||
            msg.includes('too many requests') || msg.includes('overloaded')
          ) {
            this.state.status = 'error';
            this.state.currentEntry = `Rate limit or credit error: ${msg.slice(0, 150)}`;
            this.emitProgress();
            return;
          }

          this.state.currentEntry = `Error on batch: ${msg.slice(0, 100)}. Skipping...`;
          this.emitProgress();
          await new Promise(r => setTimeout(r, 1000));
        }

        this.state.entriesProcessed = batchEnd;
        this.emitProgress();

        // Checkpoint every 15 entries (only time we rebuild index)
        if (batchEnd % 15 < BATCH_SIZE || batchEnd === entryData.length) {
          rebuildIndex(wikiDir);
          rebuildBacklinks(wikiDir);

          const currentLog = loadAbsorbLog(wikiDir);
          const auditMessages = runCheckpointAudit(wikiDir, currentLog);
          for (const msg of auditMessages) {
            console.warn(`[Checkpoint Audit] ${msg}`);
          }
        }
      }

      // Final rebuild
      rebuildIndex(wikiDir);
      rebuildBacklinks(wikiDir);

      this.state.status = 'idle';
      this.state.currentEntry = null;
      this.emitProgress();
    } catch (err) {
      this.state.status = 'error';
      this.emitProgress();
      throw err;
    }
  }

  pause(): void {
    if (this.state.status === 'running') {
      this.shouldPause = true;
    }
  }

  resume(): void {
    this.shouldPause = false;
  }

  stop(): void {
    this.shouldStop = true;
    this.shouldPause = false;
  }

  getState(): CompilerState {
    return { ...this.state };
  }

  private emitProgress(): void {
    this.onProgress?.({ ...this.state });
  }

  private async absorbBatch(
    provider: LLMProvider,
    wikiDir: string,
    batch: { file: string; content: string; id: string; title: string }[],
    absorbLog: AbsorbLogEntry[],
  ): Promise<void> {
    const schema = loadSchema(wikiDir);
    const index = loadIndex(wikiDir);
    const writeModel = loadConfigModel();
    const planModel = loadConfigFastModel(); // cheap model for planning/triage

    // Combined entry content for update/create prompts
    const combinedEntryContent = batch
      .map((e) => `--- Entry: ${e.title} (${e.id}) ---\n${e.content}`)
      .join('\n\n');

    // Step A: Get plan using FAST model
    const planMessages =
      batch.length === 1
        ? planPrompt(schema, index, batch[0].content)
        : batchPlanPrompt(
            schema,
            index,
            batch.map((e) => ({ id: e.id, content: e.content })),
          );

    let planResponse: ChatResponse;
    try {
      planResponse = await provider.chat(planMessages, {
        model: planModel,
        temperature: 0.3,
        maxTokens: 4096,
      });
    } catch (err) {
      console.error(`LLM plan call failed for batch [${batch.map(e => e.id).join(', ')}]:`, err);
      return;
    }
    accumulateTokens(this.state, planResponse);

    // Step B: Parse the plan
    let plan: Plan;
    try {
      plan = JSON.parse(stripJsonFences(planResponse.content));
    } catch {
      try {
        const retryMessages = [
          ...planMessages,
          { role: 'assistant' as const, content: planResponse.content },
          {
            role: 'user' as const,
            content:
              'That response was not valid JSON. Please return ONLY valid JSON matching the schema I specified. No markdown fences, no commentary.',
          },
        ];
        const retryResponse = await provider.chat(retryMessages, {
          model: planModel,
          temperature: 0.2,
          maxTokens: 4096,
        });
        accumulateTokens(this.state, retryResponse);
        plan = JSON.parse(stripJsonFences(retryResponse.content));
      } catch {
        console.error(`Failed to parse plan for batch [${batch.map(e => e.id).join(', ')}] after retry, skipping.`);
        return;
      }
    }

    if (!Array.isArray(plan.updates)) plan.updates = [];
    if (!Array.isArray(plan.creates)) plan.creates = [];

    // Deduplicate actions by path (batch plan may produce duplicates)
    const updatesByPath = new Map<string, PlanAction>();
    for (const u of plan.updates) {
      if (updatesByPath.has(u.path)) {
        const existing = updatesByPath.get(u.path)!;
        existing.reason += ' | ' + u.reason;
      } else {
        updatesByPath.set(u.path, { ...u });
      }
    }

    const createsByPath = new Map<string, PlanCreate>();
    for (const c of plan.creates) {
      if (createsByPath.has(c.path)) {
        const existing = createsByPath.get(c.path)!;
        existing.reason += ' | ' + c.reason;
      } else {
        createsByPath.set(c.path, { ...c });
      }
    }

    // Remove creates for paths that already exist (should be updates)
    for (const [p] of createsByPath) {
      if (fs.existsSync(path.join(wikiDir, p)) && !updatesByPath.has(p)) {
        const create = createsByPath.get(p)!;
        updatesByPath.set(p, { path: create.path, reason: create.reason });
        createsByPath.delete(p);
      }
    }

    const allCreated: string[] = [];
    const allUpdated: string[] = [];

    // Step C: Build and run all LLM tasks in parallel
    const createTasks = Array.from(createsByPath.values()).map(
      (create) => async () => {
        const articlePath = path.join(wikiDir, create.path);
        const articleDir = path.dirname(articlePath);
        if (!fs.existsSync(articleDir)) {
          fs.mkdirSync(articleDir, { recursive: true });
        }

        const createMessages = createPrompt(
          schema,
          combinedEntryContent,
          create.title,
          create.path.split('/')[0] || '',
          create.reason,
          index,
        );
        const response = await provider.chat(createMessages, {
          model: writeModel,
          temperature: 0.5,
          maxTokens: 8192,
        });
        accumulateTokens(this.state, response);

        let content = response.content.trim();
        if (content.startsWith('```')) content = stripJsonFences(content);
        fs.writeFileSync(articlePath, content, 'utf-8');
        allCreated.push(create.path);
        this.state.articlesCreated++;
      },
    );

    const updateTasks = Array.from(updatesByPath.values()).map(
      (update) => async () => {
        const articlePath = path.join(wikiDir, update.path);
        if (!fs.existsSync(articlePath)) {
          console.warn(`Plan references non-existent article: ${update.path}, skipping.`);
          return;
        }

        const currentArticle = fs.readFileSync(articlePath, 'utf-8');
        const updateMessages = updatePrompt(
          schema,
          currentArticle,
          combinedEntryContent,
          update.reason,
        );
        const response = await provider.chat(updateMessages, {
          model: writeModel,
          temperature: 0.5,
          maxTokens: 8192,
        });
        accumulateTokens(this.state, response);

        let content = response.content.trim();
        if (content.startsWith('```')) content = stripJsonFences(content);
        fs.writeFileSync(articlePath, content, 'utf-8');
        allUpdated.push(update.path);
        this.state.articlesUpdated++;
      },
    );

    // Run creates first so updates can reference newly-created articles
    if (createTasks.length > 0 && !this.shouldStop) {
      await runConcurrent(createTasks, LLM_CONCURRENCY);
    }
    if (updateTasks.length > 0 && !this.shouldStop) {
      await runConcurrent(updateTasks, LLM_CONCURRENCY);
    }

    // If stopped mid-batch, still log what we have so far

    // Step D: Log each entry in the batch as absorbed
    for (const entry of batch) {
      const logEntry: AbsorbLogEntry = {
        entryId: entry.id,
        absorbedAt: new Date().toISOString(),
        articlesCreated: allCreated,
        articlesUpdated: allUpdated,
        tokensUsed: { input: 0, output: 0 },
      };
      absorbLog.push(logEntry);

      appendLog(wikiDir, {
        entryTitle: entry.title,
        entryId: entry.id,
        created: allCreated,
        updated: allUpdated,
      });
    }
    saveAbsorbLog(wikiDir, absorbLog);
  }
}
