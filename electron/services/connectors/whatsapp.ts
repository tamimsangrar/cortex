/**
 * WhatsApp chat export parser.
 * Accepts .zip or .txt exports, auto-detects the date format, parses messages,
 * groups them by day, and creates raw entries.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getCortexDataDir } from '../../main';

const AdmZip = require('adm-zip');

// ── Types ──────────────────────────────────────────────────────────────────

export interface ParseProgress {
  phase: 'reading' | 'parsing' | 'writing' | 'done';
  current?: number;
  total?: number;
  detail?: string;
}

export interface ParseResult {
  contactName: string;
  messagesFound: number;
  entriesCreated: number;
  dateRange: { start: string; end: string };
}

export interface ImportRecord {
  contactName: string;
  date: string;
  messageCount: number;
  participants: string[];
  entryPath: string;
}

interface WhatsAppMessage {
  timestamp: Date;
  sender: string;
  content: string;
  isSystemMessage: boolean;
}

// ── Date Format Detection ──────────────────────────────────────────────────

interface DatePattern {
  name: string;
  regex: RegExp;
  parse: (match: RegExpMatchArray) => { date: Date; sender: string; content: string } | null;
}

function parseUSDate(dateStr: string, timeStr: string): Date {
  const [month, day, year] = dateStr.split('/').map(Number);
  const fullYear = year < 100 ? 2000 + year : year;
  const ampmMatch = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)/i);
  if (!ampmMatch) return new Date(NaN);
  let hours = parseInt(ampmMatch[1], 10);
  const mins = parseInt(ampmMatch[2], 10);
  const secs = parseInt(ampmMatch[3] || '0', 10);
  const ampm = ampmMatch[4].toUpperCase();
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return new Date(fullYear, month - 1, day, hours, mins, secs);
}

function parseEUDate(dateStr: string, timeStr: string): Date {
  const [day, month, year] = dateStr.split('/').map(Number);
  const fullYear = year < 100 ? 2000 + year : year;
  const [hours, mins, secs] = timeStr.split(':').map(Number);
  return new Date(fullYear, month - 1, day, hours || 0, mins || 0, secs || 0);
}

function parseISODate(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, mins, secs] = timeStr.split(':').map(Number);
  return new Date(year, month - 1, day, hours || 0, mins || 0, secs || 0);
}

const DATE_PATTERNS: DatePattern[] = [
  {
    // US bracketed: [1/15/26, 9:02:15 AM] Sender: message
    name: 'US-bracket',
    regex: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\]\s+([^:]+):\s([\s\S]*)/i,
    parse(m) {
      const date = parseUSDate(m[1], m[2]);
      if (isNaN(date.getTime())) return null;
      return { date, sender: m[3].trim(), content: m[4] };
    },
  },
  {
    // EU bracketed: [15/01/2026, 09:02:15] Sender: message
    name: 'EU-bracket',
    regex: /^\[(\d{2}\/\d{2}\/\d{4}),\s+(\d{2}:\d{2}(?::\d{2})?)\]\s+([^:]+):\s([\s\S]*)/,
    parse(m) {
      const date = parseEUDate(m[1], m[2]);
      if (isNaN(date.getTime())) return null;
      return { date, sender: m[3].trim(), content: m[4] };
    },
  },
  {
    // ISO bracketed: [2026-01-15, 09:02:15] Sender: message
    name: 'ISO-bracket',
    regex: /^\[(\d{4}-\d{2}-\d{2}),\s+(\d{2}:\d{2}(?::\d{2})?)\]\s+([^:]+):\s([\s\S]*)/,
    parse(m) {
      const date = parseISODate(m[1], m[2]);
      if (isNaN(date.getTime())) return null;
      return { date, sender: m[3].trim(), content: m[4] };
    },
  },
  {
    // No brackets US: 1/15/26, 9:02 AM - Sender: message
    name: 'US-dash',
    regex: /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\s+-\s+([^:]+):\s([\s\S]*)/i,
    parse(m) {
      const date = parseUSDate(m[1], m[2]);
      if (isNaN(date.getTime())) return null;
      return { date, sender: m[3].trim(), content: m[4] };
    },
  },
  {
    // No brackets EU: 15/01/2026, 09:02 - Sender: message
    name: 'EU-dash',
    regex: /^(\d{2}\/\d{2}\/\d{4}),\s+(\d{2}:\d{2}(?::\d{2})?)\s+-\s+([^:]+):\s([\s\S]*)/,
    parse(m) {
      const date = parseEUDate(m[1], m[2]);
      if (isNaN(date.getTime())) return null;
      return { date, sender: m[3].trim(), content: m[4] };
    },
  },
];

// System message patterns (bracketed, no "sender: content" structure)
const SYSTEM_PATTERNS = [
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\]\s+(.*)/i,
  /^\[(\d{2}\/\d{2}\/\d{4}),\s+(\d{2}:\d{2}(?::\d{2})?)\]\s+(.*)/,
  /^\[(\d{4}-\d{2}-\d{2}),\s+(\d{2}:\d{2}(?::\d{2})?)\]\s+(.*)/,
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\s+-\s+(.*)/i,
  /^(\d{2}\/\d{2}\/\d{4}),\s+(\d{2}:\d{2}(?::\d{2})?)\s+-\s+(.*)/,
];

function isSystemLine(line: string): boolean {
  const systemPhrases = [
    'Messages and calls are end-to-end encrypted',
    'end-to-end encrypted',
    'created group',
    'changed the group',
    'added you',
    'removed you',
    'left the group',
    'changed the subject',
    'changed this group',
    'security code changed',
    'disappeared messages',
    'You were added',
  ];
  return systemPhrases.some(phrase => line.toLowerCase().includes(phrase.toLowerCase()));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeHash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 8);
}

function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(d: Date): string {
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

function getExportDir(): string {
  const dir = path.join(getCortexDataDir(), 'data', 'whatsapp-export');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getEntriesDir(): string {
  const dir = path.join(getCortexDataDir(), 'raw', 'entries');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extractTxtFromZip(zipPath: string): string {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries() as Array<{ entryName: string }>;
  const txtEntry = entries.find((e) => e.entryName.endsWith('.txt'));
  if (!txtEntry) {
    throw new Error('No .txt file found inside the zip archive.');
  }
  return zip.readAsText(txtEntry);
}

function detectDatePattern(lines: string[]): DatePattern | null {
  const sample = lines.slice(0, 20);
  for (const pattern of DATE_PATTERNS) {
    let matchCount = 0;
    for (const line of sample) {
      if (pattern.regex.test(line)) matchCount++;
    }
    if (matchCount >= 2) return pattern;
  }
  // Try with fewer matches
  for (const pattern of DATE_PATTERNS) {
    for (const line of sample) {
      if (pattern.regex.test(line)) return pattern;
    }
  }
  return null;
}

// ── Core Functions ─────────────────────────────────────────────────────────

export async function parseExport(
  filePath: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseResult> {
  onProgress?.({ phase: 'reading' });

  // 1. Read the text content
  let rawText: string;
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.zip') {
    rawText = extractTxtFromZip(filePath);
  } else if (ext === '.txt') {
    rawText = fs.readFileSync(filePath, 'utf-8');
  } else {
    throw new Error('Unsupported file type. Please provide a .zip or .txt file.');
  }

  // Remove BOM if present
  if (rawText.charCodeAt(0) === 0xFEFF) {
    rawText = rawText.slice(1);
  }

  const lines = rawText.split('\n');

  // 2. Detect date format
  onProgress?.({ phase: 'parsing' });

  const pattern = detectDatePattern(lines);
  if (!pattern) {
    throw new Error('Could not detect the date format. This file may not be a WhatsApp export.');
  }

  // 3. Parse messages
  const messages: WhatsAppMessage[] = [];
  let currentMessage: WhatsAppMessage | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    const match = trimmed.match(pattern.regex);
    if (match) {
      // Save previous message
      if (currentMessage) messages.push(currentMessage);

      const parsed = pattern.parse(match);
      if (parsed) {
        const isSys = isSystemLine(parsed.content);
        currentMessage = {
          timestamp: parsed.date,
          sender: parsed.sender,
          content: parsed.content,
          isSystemMessage: isSys,
        };
      } else {
        // It's a system message line (timestamp but no sender:content split)
        currentMessage = null;
      }
    } else {
      // Check if it's a system message with timestamp but no sender
      let isSystem = false;
      for (const sp of SYSTEM_PATTERNS) {
        if (sp.test(trimmed) && isSystemLine(trimmed)) {
          isSystem = true;
          break;
        }
      }
      if (isSystem) continue;

      // Continuation line — append to current message
      if (currentMessage) {
        currentMessage.content += '\n' + trimmed;
      }
    }
  }
  // Don't forget the last message
  if (currentMessage) messages.push(currentMessage);

  // Filter out system messages
  const userMessages = messages.filter(m => !m.isSystemMessage);

  if (userMessages.length === 0) {
    throw new Error('No messages found in the export file.');
  }

  // 4. Determine contact info
  const senderCounts = new Map<string, number>();
  const participants = new Set<string>();

  for (const msg of userMessages) {
    participants.add(msg.sender);
    senderCounts.set(msg.sender, (senderCounts.get(msg.sender) || 0) + 1);
  }

  // Contact name = most frequent non-"Me" sender
  let contactName = '';
  let maxCount = 0;
  for (const [sender, count] of senderCounts) {
    if (sender.toLowerCase() !== 'me' && count > maxCount) {
      contactName = sender;
      maxCount = count;
    }
  }
  if (!contactName) contactName = Array.from(participants)[0] || 'Unknown';

  const isGroupChat = participants.size > 2;

  // 5. Group by date
  const dayGroups = new Map<string, WhatsAppMessage[]>();
  for (const msg of userMessages) {
    const dateStr = toDateString(msg.timestamp);
    if (!dayGroups.has(dateStr)) {
      dayGroups.set(dateStr, []);
    }
    dayGroups.get(dateStr)!.push(msg);
  }

  // 6. Write entries
  onProgress?.({ phase: 'writing', total: dayGroups.size });

  const entriesDir = getEntriesDir();
  const contactSlug = contactName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16);
  let entriesCreated = 0;

  const sortedDays = Array.from(dayGroups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [dateStr, dayMessages] of sortedDays) {
    const hash = makeHash(`${contactName}_${dateStr}`);
    const filename = `${dateStr}_wa_${hash}.md`;
    const filepath = path.join(entriesDir, filename);

    onProgress?.({ phase: 'writing', current: entriesCreated + 1, total: dayGroups.size, detail: dateStr });

    const participantsList = Array.from(participants);
    const heading = `WhatsApp -- ${contactName} -- ${formatDateHeading(dateStr)}`;

    const frontmatter = [
      '---',
      `id: whatsapp_${dateStr}_${contactSlug}_${hash}`,
      `date: ${dateStr}`,
      'source_type: whatsapp',
      'participants:',
      ...participantsList.map(p => `  - "${p.replace(/"/g, '\\"')}"`),
      `contact_name: "${contactName.replace(/"/g, '\\"')}"`,
      `message_count: ${dayMessages.length}`,
      `is_group_chat: ${isGroupChat}`,
      '---',
    ].join('\n');

    const body = dayMessages
      .map(msg => {
        const time = formatTime(msg.timestamp);
        const content = msg.content.includes('<Media omitted>')
          ? '[Media omitted]'
          : msg.content;
        return `**${msg.sender}** (${time}): ${content}`;
      })
      .join('\n\n');

    const content = `${frontmatter}\n\n# ${heading}\n\n${body}\n`;
    fs.writeFileSync(filepath, content, 'utf-8');
    entriesCreated++;
  }

  // 7. Copy original file to data/whatsapp-export/
  const originalName = path.basename(filePath);
  const exportCopy = path.join(getExportDir(), `${contactSlug}_${makeHash(filePath)}_${originalName}`);
  fs.copyFileSync(filePath, exportCopy);

  onProgress?.({ phase: 'done' });

  const dates = sortedDays.map(([d]) => d);

  return {
    contactName,
    messagesFound: userMessages.length,
    entriesCreated,
    dateRange: {
      start: dates[0] || '',
      end: dates[dates.length - 1] || '',
    },
  };
}

export function listImports(): ImportRecord[] {
  const entriesDir = path.join(getCortexDataDir(), 'raw', 'entries');
  if (!fs.existsSync(entriesDir)) return [];

  const files = fs.readdirSync(entriesDir).filter(f => f.includes('_wa_') && f.endsWith('.md'));
  const records: ImportRecord[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(entriesDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const contactName = fm.match(/contact_name:\s*"(.*)"/)?.[1] || 'Unknown';
      const date = fm.match(/date:\s*([\d-]+)/)?.[1] || '';
      const messageCount = parseInt(fm.match(/message_count:\s*(\d+)/)?.[1] || '0', 10);

      const participantsMatch = fm.match(/participants:\n((?:\s+-\s+"[^"]*"\n?)*)/);
      const participants: string[] = [];
      if (participantsMatch) {
        const pLines = participantsMatch[1].match(/-\s+"([^"]*)"/g);
        if (pLines) {
          for (const pl of pLines) {
            const m = pl.match(/-\s+"([^"]*)"/);
            if (m) participants.push(m[1]);
          }
        }
      }

      records.push({
        contactName,
        date,
        messageCount,
        participants,
        entryPath: `raw/entries/${file}`,
      });
    } catch {}
  }

  return records.sort((a, b) => b.date.localeCompare(a.date));
}
