/**
 * iMessage connector.
 * Reads the macOS Messages SQLite database and groups conversations
 * into per-day markdown entries.
 */
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { getCortexDataDir } from '../../main';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AccessResult {
  hasAccess: boolean;
  messageCount?: number;
}

export interface Contact {
  id: string;
  name: string;
  messageCount: number;
}

export interface SyncOptions {
  contacts?: string[];
  dateFrom?: string;  // ISO date string YYYY-MM-DD
  dateTo?: string;
  fullResync?: boolean;
}

export interface SyncProgress {
  phase: 'reading' | 'writing';
  current: number;
  total: number;
  currentChat?: string;
}

export interface SyncStats {
  entriesCreated: number;
  messagesProcessed: number;
  conversationsFound: number;
}

interface RawMessage {
  rowid: number;
  text: string;
  unix_timestamp: number;
  is_from_me: number;
  handle_id: string | null;
  chat_identifier: string;
  display_name: string | null;
}

interface GroupedEntry {
  chatIdentifier: string;
  date: string;
  displayName: string | null;
  messages: RawMessage[];
  participants: Set<string>;
  isGroupChat: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const CHAT_DB_PATH = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

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

function makeHash(chatIdentifier: string, date: string): string {
  return crypto
    .createHash('md5')
    .update(chatIdentifier + date)
    .digest('hex')
    .slice(0, 8);
}

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  let hours = d.getHours();
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${mins} ${ampm}`;
}

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toDateString(unix: number): string {
  const d = new Date(unix * 1000);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function contactLabel(msg: RawMessage, displayName: string | null, isGroup: boolean): string {
  if (msg.is_from_me) return 'Me';
  if (isGroup && msg.handle_id) return msg.handle_id;
  if (displayName) return displayName;
  return msg.handle_id ?? 'Unknown';
}

// sql.js returns rows as arrays — helper to map them into objects.
// sql.js does not export a clean Database type, so we use a structural interface.
interface SqlJsDb {
  prepare(sql: string): {
    bind(params: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
  close(): void;
}

function queryAll(db: SqlJsDb, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results: Record<string, unknown>[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// ── Core Functions ─────────────────────────────────────────────────────────

async function openChatDb(): Promise<SqlJsDb> {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(CHAT_DB_PATH);
  return new SQL.Database(buffer) as unknown as SqlJsDb;
}

export async function checkAccess(): Promise<AccessResult> {
  try {
    const db = await openChatDb();
    const rows = queryAll(db, 'SELECT COUNT(*) as cnt FROM message');
    const count = (rows[0]?.cnt as number) || 0;
    db.close();
    return { hasAccess: true, messageCount: count };
  } catch (err: unknown) {
    console.error('[iMessage] checkAccess error:', err);
    return { hasAccess: false };
  }
}

export async function getContacts(): Promise<{ contacts: Contact[] }> {
  const db = await openChatDb();
  try {
    const rows = queryAll(db, `
      SELECT
        COALESCE(h.id, c.chat_identifier) as contact_id,
        c.display_name,
        COUNT(m.rowid) as message_count
      FROM message m
      JOIN chat_message_join cmj ON m.rowid = cmj.message_id
      JOIN chat c ON cmj.chat_id = c.rowid
      LEFT JOIN handle h ON m.handle_id = h.rowid
      WHERE m.text IS NOT NULL
        AND m.associated_message_guid IS NULL
      GROUP BY contact_id
      ORDER BY message_count DESC
    `);

    const contacts: Contact[] = rows.map((r) => ({
      id: r.contact_id as string,
      name: (r.display_name as string) || (r.contact_id as string),
      messageCount: r.message_count as number,
    }));

    return { contacts };
  } finally {
    db.close();
  }
}

export async function sync(
  options: SyncOptions = {},
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncStats> {
  const db = await openChatDb();
  try {
    const conditions = [
      'm.text IS NOT NULL',
      'm.associated_message_guid IS NULL',
    ];
    const params: unknown[] = [];

    const config = readConfig();
    const effectiveDateFrom = options.fullResync
      ? undefined
      : (options.dateFrom ?? (config.imessageLastSyncDate as string | undefined));

    if (effectiveDateFrom) {
      const unixFrom = Math.floor(new Date(effectiveDateFrom).getTime() / 1000);
      conditions.push('m.date / 1000000000 + 978307200 > ?');
      params.push(unixFrom);
    }

    if (options.dateTo) {
      const unixTo = Math.floor(new Date(options.dateTo + 'T23:59:59').getTime() / 1000);
      conditions.push('m.date / 1000000000 + 978307200 <= ?');
      params.push(unixTo);
    }

    // Note: sql.js doesn't support IN with dynamic params easily, so filter contacts in JS
    const contactFilter = options.contacts && options.contacts.length > 0
      ? new Set(options.contacts)
      : null;

    const whereClause = conditions.join(' AND ');
    const sql = `
      SELECT
        m.rowid,
        m.text,
        m.date / 1000000000 + 978307200 as unix_timestamp,
        m.is_from_me,
        h.id as handle_id,
        c.chat_identifier,
        c.display_name
      FROM message m
      JOIN chat_message_join cmj ON m.rowid = cmj.message_id
      JOIN chat c ON cmj.chat_id = c.rowid
      LEFT JOIN handle h ON m.handle_id = h.rowid
      WHERE ${whereClause}
      ORDER BY m.date ASC
    `;

    onProgress?.({ phase: 'reading', current: 0, total: 0 });

    let rows = queryAll(db, sql, params) as unknown as RawMessage[];

    // Filter contacts in JS if needed
    if (contactFilter) {
      rows = rows.filter(r =>
        contactFilter.has(r.handle_id ?? '') || contactFilter.has(r.chat_identifier)
      );
    }

    const totalMessages = rows.length;
    onProgress?.({ phase: 'reading', current: totalMessages, total: totalMessages });

    // Group messages by (chat_identifier, date)
    const groups = new Map<string, GroupedEntry>();

    for (const msg of rows) {
      const dateStr = toDateString(msg.unix_timestamp);
      const key = `${msg.chat_identifier}||${dateStr}`;

      if (!groups.has(key)) {
        const isGroup = !!(msg.display_name) || msg.chat_identifier.startsWith('chat');
        groups.set(key, {
          chatIdentifier: msg.chat_identifier,
          date: dateStr,
          displayName: msg.display_name,
          messages: [],
          participants: new Set<string>(),
          isGroupChat: isGroup,
        });
      }

      const group = groups.get(key)!;
      group.messages.push(msg);
      if (msg.handle_id) {
        group.participants.add(msg.handle_id);
      }
    }

    // Write markdown files
    const entriesDir = path.join(getCortexDataDir(), 'raw', 'entries');
    fs.mkdirSync(entriesDir, { recursive: true });

    const groupEntries = Array.from(groups.values());
    let entriesCreated = 0;

    for (let i = 0; i < groupEntries.length; i++) {
      const entry = groupEntries[i];
      const hash = makeHash(entry.chatIdentifier, entry.date);
      const filename = `${entry.date}_msg_${hash}.md`;
      const filepath = path.join(entriesDir, filename);

      const contactName = entry.displayName || (entry.participants.size === 1
        ? Array.from(entry.participants)[0]
        : entry.chatIdentifier);

      onProgress?.({
        phase: 'writing',
        current: i + 1,
        total: groupEntries.length,
        currentChat: contactName,
      });

      const participantsList = Array.from(entry.participants);
      const heading = `iMessage - ${contactName} - ${formatDateHeading(entry.date)}`;

      const frontmatter = [
        '---',
        `id: imessage_${entry.date}_${hash}`,
        `date: ${entry.date}`,
        'source_type: imessage',
        'participants:',
        ...participantsList.map((p) => `  - "${p}"`),
        `contact_name: "${contactName}"`,
        `message_count: ${entry.messages.length}`,
        `is_group_chat: ${entry.isGroupChat}`,
        `chat_id: "${entry.chatIdentifier}"`,
        '---',
      ].join('\n');

      const body = entry.messages
        .map((msg) => {
          const speaker = contactLabel(msg, contactName, entry.isGroupChat);
          const time = formatTime(msg.unix_timestamp);
          return `**${speaker}** (${time}): ${msg.text}`;
        })
        .join('\n\n');

      const content = `${frontmatter}\n\n# ${heading}\n\n${body}\n`;

      fs.writeFileSync(filepath, content, 'utf-8');
      entriesCreated++;
    }

    const updatedConfig = readConfig();
    updatedConfig.imessageLastSyncDate = new Date().toISOString().split('T')[0];
    writeConfig(updatedConfig);

    return {
      entriesCreated,
      messagesProcessed: totalMessages,
      conversationsFound: groups.size,
    };
  } finally {
    db.close();
  }
}

export function getConfig(): Record<string, unknown> {
  const config = readConfig();
  return {
    lastSyncDate: config.imessageLastSyncDate ?? null,
    filters: config.imessageFilters ?? null,
  };
}
