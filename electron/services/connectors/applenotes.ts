/**
 * Apple Notes connector.
 * Reads notes via AppleScript automation and converts them to raw entries.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { getCortexDataDir } from '../../main';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AccessResult {
  hasAccess: boolean;
  noteCount?: number;
  error?: string;
}

export interface NoteInfo {
  title: string;
  date: string;
  wordCount: number;
}

export interface SyncProgress {
  phase: 'reading' | 'writing' | 'done';
  current?: number;
  total?: number;
  detail?: string;
}

export interface SyncResult {
  entriesCreated: number;
  notesProcessed: number;
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

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getEntriesDir(): string {
  const dir = path.join(getCortexDataDir(), 'raw', 'entries');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

function runAppleScript(script: string): string {
  const scriptDir = path.join(getCortexDataDir(), 'data');
  fs.mkdirSync(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, '_temp_notes.scpt');
  try {
    fs.writeFileSync(scriptPath, script, 'utf-8');
    const result = execSync(`osascript "${scriptPath}"`, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120000,
    });
    return result.toString('utf-8');
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

// ── Core Functions ─────────────────────────────────────────────────────────

export async function checkAccess(): Promise<AccessResult> {
  try {
    const script = `
tell application "Notes"
  set noteCount to count of notes
  return noteCount
end tell
`;
    const result = runAppleScript(script);
    const count = parseInt(result.trim(), 10);
    if (isNaN(count)) {
      return { hasAccess: false, error: 'Could not parse note count' };
    }
    return { hasAccess: true, noteCount: count };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AppleNotes] checkAccess error:', msg);
    if (msg.includes('Not authorized') || msg.includes('assistive') || msg.includes('permission')) {
      return { hasAccess: false, error: 'Automation permission required. Grant access in System Settings > Privacy & Security > Automation.' };
    }
    return { hasAccess: false, error: msg };
  }
}

export async function getNotes(): Promise<{ notes: NoteInfo[] }> {
  const script = `
set output to ""
tell application "Notes"
  repeat with n in notes
    set noteTitle to name of n
    set noteBody to plaintext of n
    set noteDate to modification date of n
    set wordCount to count of words of noteBody
    set dateStr to (year of noteDate as string) & "-"
    set m to (month of noteDate as integer)
    if m < 10 then
      set dateStr to dateStr & "0" & (m as string)
    else
      set dateStr to dateStr & (m as string)
    end if
    set dateStr to dateStr & "-"
    set d to (day of noteDate as integer)
    if d < 10 then
      set dateStr to dateStr & "0" & (d as string)
    else
      set dateStr to dateStr & (d as string)
    end if
    set output to output & noteTitle & "\\t" & dateStr & "\\t" & (wordCount as string) & "\\n"
  end repeat
end tell
return output
`;
  const result = runAppleScript(script);
  const lines = result.trim().split('\n').filter(Boolean);
  const notes: NoteInfo[] = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      notes.push({
        title: parts[0],
        date: parts[1],
        wordCount: parseInt(parts[2], 10) || 0,
      });
    }
  }
  return { notes };
}

export async function sync(
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  onProgress?.({ phase: 'reading' });

  // Fetch all notes with content via AppleScript
  const script = `
set output to ""
set delim to "<<NOTE_DELIM>>"
set fieldDelim to "<<FIELD_DELIM>>"
tell application "Notes"
  set allNotes to notes
  repeat with n in allNotes
    set noteTitle to name of n
    set noteBody to plaintext of n
    set noteDate to modification date of n
    set noteCreated to creation date of n
    set dateStr to (year of noteDate as string) & "-"
    set m to (month of noteDate as integer)
    if m < 10 then
      set dateStr to dateStr & "0" & (m as string)
    else
      set dateStr to dateStr & (m as string)
    end if
    set dateStr to dateStr & "-"
    set d to (day of noteDate as integer)
    if d < 10 then
      set dateStr to dateStr & "0" & (d as string)
    else
      set dateStr to dateStr & (d as string)
    end if
    set createdStr to (year of noteCreated as string) & "-"
    set cm to (month of noteCreated as integer)
    if cm < 10 then
      set createdStr to createdStr & "0" & (cm as string)
    else
      set createdStr to createdStr & (cm as string)
    end if
    set createdStr to createdStr & "-"
    set cd to (day of noteCreated as integer)
    if cd < 10 then
      set createdStr to createdStr & "0" & (cd as string)
    else
      set createdStr to createdStr & (cd as string)
    end if
    set output to output & noteTitle & fieldDelim & dateStr & fieldDelim & createdStr & fieldDelim & noteBody & delim
  end repeat
end tell
return output
`;

  const result = runAppleScript(script);
  const noteChunks = result.split('<<NOTE_DELIM>>').filter(s => s.trim());

  onProgress?.({ phase: 'reading', current: noteChunks.length, total: noteChunks.length });

  const entriesDir = getEntriesDir();
  let entriesCreated = 0;

  onProgress?.({ phase: 'writing', total: noteChunks.length });

  for (let i = 0; i < noteChunks.length; i++) {
    const fields = noteChunks[i].split('<<FIELD_DELIM>>');
    if (fields.length < 4) continue;

    const title = fields[0].trim();
    const dateStr = fields[1].trim();
    const createdStr = fields[2].trim();
    const body = fields[3].trim();

    if (!title || !body) continue;

    onProgress?.({ phase: 'writing', current: i + 1, total: noteChunks.length, detail: title });

    const hash = makeHash(title + dateStr);
    const filename = `${dateStr}_note_${hash}.md`;
    const filepath = path.join(entriesDir, filename);
    const wordCount = body.split(/\s+/).filter(Boolean).length;

    const frontmatter = [
      '---',
      `id: applenotes_${dateStr}_${hash}`,
      `date: ${dateStr}`,
      'source_type: apple-notes',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `created_date: ${createdStr}`,
      `word_count: ${wordCount}`,
      '---',
    ].join('\n');

    const content = `${frontmatter}\n\n# ${title}\n\n${body}\n`;
    fs.writeFileSync(filepath, content, 'utf-8');
    entriesCreated++;
  }

  const updatedConfig = readConfig();
  updatedConfig.appleNotesLastSyncDate = new Date().toISOString().split('T')[0];
  writeConfig(updatedConfig);

  onProgress?.({ phase: 'done' });

  return {
    entriesCreated,
    notesProcessed: noteChunks.length,
  };
}

export function getConfig(): Record<string, unknown> {
  const config = readConfig();
  return {
    lastSyncDate: config.appleNotesLastSyncDate ?? null,
  };
}
