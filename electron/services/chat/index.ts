/**
 * Chat service — RAG-based Q&A over the personal wiki.
 * Uses a two-step pipeline: (1) find relevant articles via the LLM,
 * (2) synthesize an answer grounded in those articles.
 * Also supports filing chat answers back into the wiki.
 */
import fs from 'fs';
import path from 'path';
import { getCortexDataDir } from '../../main';
import { getActiveProvider } from '../llm';
import { LLMProvider, ChatMessage as LLMChatMessage } from '../llm/types';
import { rebuildIndex, appendLog } from '../compiler/indexer';

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

// ── Types ────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

export interface QueryResult {
  content: string;
  sources: string[];
}

type ThinkingCallback = (step: string) => void;

// ── Helpers ──────────────────────────────────────────────────

function getChatsDir(): string {
  const dir = path.join(getCortexDataDir(), 'chats');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getWikiDir(): string {
  return path.join(getCortexDataDir(), 'wiki');
}

function stripJsonFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7);
  else if (s.startsWith('```')) s = s.slice(3);
  if (s.endsWith('```')) s = s.slice(0, -3);
  return s.trim();
}

function extractWikilinks(text: string): string[] {
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    links.push(match[1].trim());
  }
  return [...new Set(links)];
}

// ── Chat Persistence ─────────────────────────────────────────

export function listChats(): ChatSummary[] {
  const dir = getChatsDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const summaries: ChatSummary[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const session: ChatSession = JSON.parse(raw);
      summaries.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        messageCount: session.messages.length,
      });
    } catch {
      // Skip corrupt files
    }
  }

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getChat(id: string): ChatSession | null {
  const filePath = path.join(getChatsDir(), `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function saveChat(session: ChatSession): void {
  const filePath = path.join(getChatsDir(), `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

export function deleteChat(id: string): boolean {
  const filePath = path.join(getChatsDir(), `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function createChat(): ChatSession {
  const session: ChatSession = {
    id: `chat_${Date.now()}`,
    title: 'New Chat',
    messages: [],
    createdAt: new Date().toISOString(),
  };
  saveChat(session);
  return session;
}

// ── Core Query ───────────────────────────────────────────────

export async function query(
  provider: LLMProvider,
  userMessage: string,
  chatHistory: ChatMessage[],
  onThinking?: ThinkingCallback,
): Promise<QueryResult> {
  const wikiDir = getWikiDir();
  const indexPath = path.join(wikiDir, '_index.md');

  // Check if wiki index exists
  if (!fs.existsSync(indexPath)) {
    return {
      content: "No wiki articles yet. Run the compiler first to build your wiki, then I can answer questions about it.",
      sources: [],
    };
  }

  // Step 1: Read the index
  onThinking?.('Reading index...');
  const indexContent = fs.readFileSync(indexPath, 'utf-8');
  const configModel = loadConfigModel();

  if (!indexContent.trim()) {
    return {
      content: "The wiki index is empty. Run the compiler to absorb some entries first.",
      sources: [],
    };
  }

  // Step 2: Find relevant articles
  onThinking?.('Finding relevant articles...');
  const findMessages: LLMChatMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful assistant that analyzes a wiki index to find relevant articles. Return ONLY a JSON array of file paths, no other text.',
    },
    {
      role: 'user',
      content: `Here is the wiki index:\n<index>\n${indexContent}\n</index>\n\nThe user asks: "${userMessage}"\n\nWhich articles are most relevant to answering this question? Return a JSON array of file paths, max 8. Example: ["people/john-doe.md", "projects/my-project.md"]`,
    },
  ];

  const findResponse = await provider.chat(findMessages, {
    model: configModel,
    temperature: 0.3,
    maxTokens: 1024,
  });

  let articlePaths: string[] = [];
  try {
    articlePaths = JSON.parse(stripJsonFences(findResponse.content));
    if (!Array.isArray(articlePaths)) articlePaths = [];
  } catch {
    // If parsing fails, try to extract paths from the text
    const pathPattern = /["']([^"']+\.md)["']/g;
    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(findResponse.content)) !== null) {
      articlePaths.push(match[1]);
    }
  }

  // Filter to only existing files
  articlePaths = articlePaths.filter(p => {
    const fullPath = path.join(wikiDir, p);
    return fs.existsSync(fullPath);
  });

  if (articlePaths.length === 0) {
    onThinking?.('No relevant articles found.');
    return {
      content: "I couldn't find any relevant articles in the wiki for your question. The wiki may not cover this topic yet.",
      sources: [],
    };
  }

  onThinking?.(`Found ${articlePaths.length} relevant article${articlePaths.length === 1 ? '' : 's'}...`);

  // Step 3: Read article contents
  onThinking?.('Reading articles...');
  const articleContents: string[] = [];
  for (const articlePath of articlePaths) {
    const fullPath = path.join(wikiDir, articlePath);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      articleContents.push(`--- ${articlePath} ---\n${content}`);
    } catch {
      // Skip unreadable files
    }
  }

  // Step 4: Build conversation history for context
  const historyText = chatHistory
    .slice(-10) // Last 10 messages for context
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  // Step 5: Synthesize answer
  onThinking?.('Synthesizing answer...');
  const synthesizeMessages: LLMChatMessage[] = [
    {
      role: 'system',
      content: `You are answering questions about a personal knowledge wiki.

Rules:
- Lead with the answer, then provide supporting detail.
- Use [[wikilinks]] when referencing articles (use the article title or filename without .md extension).
- Cite which articles your answer draws from.
- Acknowledge gaps. If the wiki doesn't cover something, say so.
- Don't invent information not in the articles.
- Use direct quotes sparingly for emotional weight.
- Be conversational and helpful.`,
    },
    {
      role: 'user',
      content: `Here are the relevant articles:\n<articles>\n${articleContents.join('\n\n')}\n</articles>\n\n${historyText ? `Chat history:\n${historyText}\n\n` : ''}User asks: "${userMessage}"\n\nAnswer using the wiki articles above.`,
    },
  ];

  const synthesizeResponse = await provider.chat(synthesizeMessages, {
    model: configModel,
    temperature: 0.7,
    maxTokens: 4096,
  });

  // Step 6: Determine which articles were actually referenced
  const referencedLinks = extractWikilinks(synthesizeResponse.content);
  const sources = [...new Set([
    ...articlePaths,
    ...referencedLinks
      .map(link => {
        // Try to match wikilink to article path
        const withMd = link.endsWith('.md') ? link : `${link}.md`;
        if (articlePaths.some(p => p === withMd || p.endsWith(`/${withMd}`) || p.replace('.md', '') === link)) {
          return articlePaths.find(p => p === withMd || p.endsWith(`/${withMd}`) || p.replace('.md', '') === link) || '';
        }
        return '';
      })
      .filter(Boolean),
  ])];

  onThinking?.('Done.');

  return {
    content: synthesizeResponse.content,
    sources,
  };
}

// ── File Answer into Wiki ────────────────────────────────────

export async function fileAnswer(
  provider: LLMProvider,
  answer: string,
  chatSession: ChatSession,
): Promise<string> {
  const baseDir = getCortexDataDir();
  const wikiDir = getWikiDir();
  const entriesDir = path.join(baseDir, 'raw', 'entries');
  const configModel = loadConfigModel();

  // Step 1: Save as raw entry so it enters the compilation pipeline
  if (!fs.existsSync(entriesDir)) {
    fs.mkdirSync(entriesDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const hash = Date.now().toString(36);
  const entryFilename = `${dateStr}_chat_${hash}.md`;
  const entryId = `chat-answer-${hash}`;

  const rawContent = `---
id: ${entryId}
date: ${now.toISOString()}
source_type: chat-answer
chat_id: ${chatSession.id}
chat_title: "${chatSession.title.replace(/"/g, '\\"')}"
---

# Chat Answer: ${chatSession.title}

${answer}
`;

  fs.writeFileSync(path.join(entriesDir, entryFilename), rawContent, 'utf-8');

  // Step 2: Use the compiler's create prompt to produce a proper wiki article
  const schemaPath = path.join(wikiDir, '_schema.md');
  const schema = fs.existsSync(schemaPath)
    ? fs.readFileSync(schemaPath, 'utf-8')
    : '';

  const indexPath = path.join(wikiDir, '_index.md');
  const index = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf-8')
    : '';

  // Use a plan-like call to determine placement
  const planMessages: LLMChatMessage[] = [
    {
      role: 'system',
      content: 'You are a writer compiling a personal knowledge wiki. Determine the best category and filename for this content. Return ONLY valid JSON.',
    },
    {
      role: 'user',
      content: `Wiki schema:\n<schema>\n${schema}\n</schema>\n\nWiki index:\n<index>\n${index || '(empty)'}\n</index>\n\nContent to file:\n${answer}\n\nReturn JSON: { "path": "category/filename.md", "title": "Article Title", "reason": "why this article" }`,
    },
  ];

  const planResponse = await provider.chat(planMessages, {
    model: configModel,
    temperature: 0.3,
    maxTokens: 1024,
  });

  let articleMeta = { path: '', title: '', reason: '' };
  try {
    articleMeta = JSON.parse(stripJsonFences(planResponse.content));
  } catch {
    const slug = chatSession.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    articleMeta = {
      path: `notes/${slug}.md`,
      title: chatSession.title,
      reason: 'Filed from chat answer',
    };
  }

  // Use the compiler's create prompt for consistent quality
  const { createPrompt } = await import('../compiler/prompts');
  const directory = articleMeta.path.split('/')[0] || '';
  const createMessages = createPrompt(
    schema,
    rawContent,
    articleMeta.title,
    directory,
    articleMeta.reason,
    index,
  );

  const createResponse = await provider.chat(createMessages, {
    model: configModel,
    temperature: 0.5,
    maxTokens: 8192,
  });

  let content = createResponse.content.trim();
  if (content.startsWith('```')) {
    content = stripJsonFences(content);
  }

  // Write the article
  const suggestedPath = articleMeta.path;
  const articlePath = path.join(wikiDir, suggestedPath);
  const articleDir = path.dirname(articlePath);
  if (!fs.existsSync(articleDir)) {
    fs.mkdirSync(articleDir, { recursive: true });
  }
  fs.writeFileSync(articlePath, content, 'utf-8');

  // Update index and log
  rebuildIndex(wikiDir);
  appendLog(wikiDir, {
    entryTitle: `Chat answer: ${chatSession.title}`,
    entryId,
    created: [suggestedPath],
    updated: [],
  });

  return suggestedPath;
}
