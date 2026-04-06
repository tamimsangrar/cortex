/**
 * LLM prompt templates for the wiki compiler.
 * Builds system/user message pairs for the plan, update, and create phases.
 */
import fs from 'fs';
import path from 'path';
import { ChatMessage } from '../llm/types';
import { getCortexDataDir } from '../../main';

function loadUserProfile(): { name: string; nicknames: string[] } {
  try {
    const configPath = path.join(getCortexDataDir(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const profile = config.userProfile || {};
      return { name: profile.name || '', nicknames: profile.nicknames || [] };
    }
  } catch {
    // silent
  }
  return { name: '', nicknames: [] };
}

function subjectContext(): string {
  const { name } = loadUserProfile();
  if (!name) return '';
  return ` The subject of this wiki is ${name}. Messages from "Me" are from ${name}.`;
}

export function planPrompt(schema: string, index: string, entry: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are a writer compiling a personal knowledge wiki. Not a filing clerk. A writer.

Your job is to absorb a new entry into the wiki - understanding what it means, what patterns it reveals, and how it connects to existing knowledge. The question is never "where do I file this?" It is: "What does this mean, and how does it connect to what I already know?"${subjectContext()}`,
    },
    {
      role: 'user',
      content: `Here are the wiki's conventions and standards:
<schema>
${schema}
</schema>

Here is the current wiki index (may be empty if this is a new wiki):
<index>
${index || '(empty - no articles exist yet)'}
</index>

Here is a new entry to absorb:
<entry>
${entry}
</entry>

First, ANALYZE this entry before planning anything:
- What does this MEAN? Not where does it go - what does it mean?
- What patterns does it reinforce or break?
- What relationships does it reveal or change?
- What's said AND what's unsaid?
- Is there an emerging concept, tension, or philosophy here that doesn't have its own page yet?

Then produce a plan. For each article you want to create or update, explain WHY - not just what.

GOOD analysis example:
"This entry reveals a recurring pattern where the subject offers emotional labor as a service rather than a natural expression of care. Combined with 3 previous entries about friendship dynamics, this suggests an emerging tension between 'caretaking as identity' and 'caretaking as performance' that deserves its own concept page."

BAD analysis example:
"This entry is about a conversation with a friend. It should be added to the friend's page."

The good analysis names what it means. The bad analysis names where it goes. Always be the good one.

Return JSON (no markdown fences, just raw JSON):
{
  "analysis": "Your honest assessment of what this entry reveals - this is the most important field",
  "updates": [
    {
      "path": "directory/filename.md",
      "reason": "Why this article needs updating - what new understanding does this entry bring"
    }
  ],
  "creates": [
    {
      "path": "directory/filename.md",
      "title": "Article Title",
      "reason": "Why this page needs to exist now - what story does it tell"
    }
  ]
}

Rules:
- Follow the standards in <schema> exactly.
- Every entry must be absorbed somewhere. Nothing gets dropped.
- The question is never "where do I file this?" It is: "what does this mean, and how does it connect to what I already know?"
- Anti-cramming: if you're about to add a third distinct paragraph about a sub-topic to an existing article, STOP. That sub-topic NEEDS its own page. Create it.
- Anti-thinning: do NOT create a page unless you can write 15+ meaningful lines RIGHT NOW from this entry. A stub is a failure.
- Concept articles (patterns, philosophies, tensions) are the MOST VALUABLE pages. Actively look for them.
- When creating concept articles:
  - Open with a definition that synthesizes across multiple entries.
  - Include at least one section that names the tension or mechanism.
  - End by connecting to the broader arc.
  - Describe the mechanism, not just a list of instances.
- Use directory paths from the taxonomy in the schema (people/, projects/, patterns/, relationships/, transitions/, etc.).
- Filenames should be kebab-case: people/john-doe.md, patterns/late-night-building.md
- Return ONLY valid JSON. No markdown fences, no commentary outside the JSON.`,
    },
  ];
}

export function updatePrompt(
  schema: string,
  currentArticle: string,
  entry: string,
  reason: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are a writer maintaining a personal knowledge wiki article. You integrate new information into existing articles so they read as coherent wholes - as if one writer wrote them from scratch knowing everything.${subjectContext()}`,
    },
    {
      role: 'user',
      content: `Here are the wiki's conventions and standards:
<schema>
${schema}
</schema>

Here is the current article - read it completely before changing anything:
<article>
${currentArticle}
</article>

Here is the new entry being absorbed:
<entry>
${entry}
</entry>

Here is why this article needs updating:
<reason>
${reason}
</reason>

Rewrite this article to incorporate the new information. The result must read as a COHERENT WHOLE - as if one writer wrote it from scratch knowing everything.

Writing rules (from schema, reinforced here because they matter):
- Integrate, don't append. If you catch yourself adding a paragraph at the bottom, stop and reorganize.
- Organize by THEME, not chronology. "In January... then in February..." is an event log, not an article.
- Direct quotes carry emotional weight. Choose quotes that reveal character, not quotes that state facts. Max 2 per article.
- Attribution over assertion: "He described it as energizing" not "It was energizing."
- One claim per sentence. Short sentences. Dates and specifics replace adjectives.
- Never use em dashes, peacock words ("legendary," "visionary," "groundbreaking"), editorial voice ("interestingly," "importantly"), rhetorical questions, progressive narrative ("would go on to," "embarked on"), or qualifiers ("genuine," "raw," "powerful," "profound").
- Use [[wikilinks]] to reference other articles. These are the connective tissue.
- Every section should get meaningfully BETTER, not just longer. If a section is already good and the new entry doesn't change it, leave it alone.
- Add the entry's source ID to the sources list in frontmatter.
- Update last_updated in frontmatter to today's date.

Return the complete updated article (full file content including frontmatter). No markdown fences wrapping the output - just the article content starting with ---.`,
    },
  ];
}

export function createPrompt(
  schema: string,
  entry: string,
  title: string,
  directory: string,
  reason: string,
  index: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are a writer creating a new article for a personal knowledge wiki. Every article must justify its existence - 15+ meaningful lines minimum, organized by theme, written in encyclopedic tone.${subjectContext()}`,
    },
    {
      role: 'user',
      content: `Here are the wiki's conventions and standards:
<schema>
${schema}
</schema>

Here is the current wiki index (for cross-referencing):
<index>
${index || '(empty - no articles exist yet)'}
</index>

Here is the entry that prompted this new article:
<entry>
${entry}
</entry>

Create a new wiki article with:
- Title: ${title}
- Directory: ${directory}
- Reason for creation: ${reason}

Article requirements:
- Follow the frontmatter format from the schema exactly.
- type field should match the directory (people/ -> person, projects/ -> project, patterns/ -> pattern, etc.)
- Set created and last_updated to today's date.
- Include the entry's source ID in the sources list.
- Minimum 15 lines of meaningful content. This is the floor, not the target. Check the length targets in the schema for your article type.
- Include [[wikilinks]] to at least 2 existing articles if they exist. No page is an island.
- Organize by theme, not chronology. Use the structure template for this article type from the schema.
- Wikipedia tone: flat, factual, encyclopedic. No em dashes, no peacock words.
- Attribution over assertion: "He described it as energizing" not "It was energizing."
- One claim per sentence. Short sentences. Dates and specifics replace adjectives.
- Maximum 2 direct quotes. Pick the lines that reveal character, not the ones that state facts.
- If this is a concept article (pattern, philosophy, tension): open with a definition that synthesizes across multiple entries. Include at least one section that names the tension or mechanism. End by connecting to the broader arc. Describe the mechanism, not just a list of instances.

Return the complete article (full file content including frontmatter). No markdown fences wrapping the output - just the article content starting with ---.`,
    },
  ];
}

export function batchPlanPrompt(
  schema: string,
  index: string,
  entries: { id: string; content: string }[],
): ChatMessage[] {
  const entriesBlock = entries
    .map((e, i) => `<entry id="${e.id}" number="${i + 1}">\n${e.content}\n</entry>`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `You are a writer compiling a personal knowledge wiki. Not a filing clerk. A writer.

Your job is to absorb ${entries.length} new entries into the wiki simultaneously — understanding what each means, what patterns they reveal, and how they connect to existing knowledge and to each other.${subjectContext()}`,
    },
    {
      role: 'user',
      content: `Here are the wiki's conventions and standards:
<schema>
${schema}
</schema>

Here is the current wiki index (may be empty if this is a new wiki):
<index>
${index || '(empty - no articles exist yet)'}
</index>

Here are ${entries.length} new entries to absorb:
${entriesBlock}

For ALL entries combined, produce a SINGLE unified plan. If multiple entries relate to the same topic or person, merge their insights into one update/create action rather than separate ones.

ANALYZE these entries before planning:
- What does each entry MEAN? Not where does it go — what does it mean?
- Do any entries connect to or reinforce each other?
- What patterns do they collectively reinforce or break?
- What relationships do they reveal or change?

Return JSON (no markdown fences, just raw JSON):
{
  "analysis": "Your honest assessment of what these entries collectively reveal",
  "updates": [
    {
      "path": "directory/filename.md",
      "reason": "Why this article needs updating and which entry/entries drive this"
    }
  ],
  "creates": [
    {
      "path": "directory/filename.md",
      "title": "Article Title",
      "reason": "Why this page needs to exist now — what story does it tell"
    }
  ]
}

Rules:
- Follow the standards in <schema> exactly.
- Every entry must be absorbed somewhere. Nothing gets dropped.
- The question is never "where do I file this?" It is: "what does this mean, and how does it connect to what I already know?"
- Anti-cramming: if you're about to add a third distinct paragraph about a sub-topic to an existing article, STOP. That sub-topic NEEDS its own page. Create it.
- Anti-thinning: do NOT create a page unless you can write 15+ meaningful lines RIGHT NOW. A stub is a failure.
- Concept articles (patterns, philosophies, tensions) are the MOST VALUABLE pages.
- MERGE related actions: if two entries both relate to the same person, produce ONE update for that person's article, not two.
- Use directory paths from the taxonomy in the schema.
- Filenames: kebab-case.
- Return ONLY valid JSON.`,
    },
  ];
}

export function indexPrompt(articles: { path: string; title: string; type: string; aliases?: string[] }[]): string {
  const lines = ['# Wiki Index\n'];

  const byDir: Record<string, { path: string; title: string; type: string; aliases?: string[] }[]> = {};
  for (const article of articles) {
    const dir = article.path.split('/')[0] || 'uncategorized';
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(article);
  }

  const dirOrder = [
    'people', 'projects', 'places', 'patterns', 'philosophies',
    'decisions', 'eras', 'events', 'relationships', 'ideas',
    'mentorships', 'communities', 'strategies', 'techniques', 'skills',
    'artifacts', 'transitions', 'experiments', 'setbacks',
    'restaurants', 'health', 'routines', 'metaphors', 'assessments',
    'touchstones', 'identities',
  ];

  const sortedDirs = [
    ...dirOrder.filter(d => byDir[d]),
    ...Object.keys(byDir).filter(d => !dirOrder.includes(d)).sort(),
  ];

  for (const dir of sortedDirs) {
    const dirArticles = byDir[dir];
    if (!dirArticles?.length) continue;
    lines.push(`## ${dir.charAt(0).toUpperCase() + dir.slice(1)}\n`);
    for (const a of dirArticles.sort((x, y) => x.title.localeCompare(y.title))) {
      const aliasPart = a.aliases && a.aliases.length > 0
        ? ` also: ${a.aliases.join(', ')}`
        : '';
      lines.push(`- [[${a.path}|${a.title}]]${aliasPart}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
