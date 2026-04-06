/**
 * Wiki schema definition and subject identity injection.
 * Provides the default wiki writing guidelines, directory taxonomy, and
 * article structure templates used by the compiler's LLM prompts.
 */
import fs from 'fs';
import path from 'path';
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

function buildSubjectIdentityBlock(): string {
  const { name, nicknames } = loadUserProfile();
  if (!name) return '';
  const aliasLine = nicknames.length > 0
    ? `Known aliases: ${nicknames.join(', ')}\n`
    : '';
  return `\n## Subject Identity
The subject of this wiki is ${name}. In source entries, messages from "Me" are from ${name}.
${aliasLine}Do NOT create a wiki article about ${name} as a person. ${name} IS the subject. All articles are about ${name}'s life, relationships, and experiences.
When writing about people, frame it as "${name}'s relationship with X" not "X's relationship with an unnamed subject."
`;
}

const DEFAULT_SCHEMA = `# Wiki Schema

## The Golden Rule

This is not Wikipedia about the thing. It is about the thing's role in the subject's life. A page about a book is not a book review. It is about what that book meant to the person, when they read it, what it changed.

## Writing Standards

### Tone: Wikipedia, Not AI
- Flat, factual, encyclopedic. State what happened. The article stays neutral; direct quotes carry the emotional weight.
- Attribution over assertion: "He described it as energizing" not "It was energizing."
- One claim per sentence. Short sentences.
- Simple past or present tense.
- Let facts imply significance. Dates and specifics replace adjectives.

### Banned Words and Patterns
Never use any of the following:
- Em dashes
- Peacock words: "legendary," "visionary," "groundbreaking," "deeply," "truly"
- Editorial voice: "interestingly," "importantly," "it should be noted"
- Rhetorical questions
- Progressive narrative: "would go on to," "embarked on," "this journey"
- Qualifiers: "genuine," "raw," "powerful," "profound"

### Quote Discipline
- Maximum 2 direct quotes per article. Pick the line that hits hardest.
- Quotes should reveal character, not state facts. A quote like "When was the last time you asked me something about me?" is perfect. A quote like "okay sure" is worthless.
- The article is neutral. The quotes do the feeling.

### Structure
- Organize by theme, not chronology. "In January... then in February..." is an event log, not an article.
- Every section should get meaningfully richer, not just longer.
- Anti-cramming: if a subtopic is getting its third paragraph, it deserves its own page. Create it.
- Anti-thinning: do NOT create a page unless you can write 15+ meaningful lines right now. A stub is a failure.
- Concept articles (patterns, philosophies, tensions) are the most valuable pages. Actively look for them.

## Article Length Targets

| Type                              | Lines  |
|-----------------------------------|--------|
| Person (1 reference)              | 20-30  |
| Person (3+ references)            | 40-80  |
| Place/restaurant                  | 20-40  |
| Philosophy/pattern/relationship   | 40-80  |
| Era                               | 60-100 |
| Decision/transition               | 40-70  |
| Experiment/idea                   | 25-45  |
| Minimum (anything)                | 15     |

## Structure Templates by Type

| Type        | Structure                                                       |
|-------------|-----------------------------------------------------------------|
| person      | By role/relationship phase                                      |
| place       | By what happened there and what it meant                        |
| project     | By conception, development, outcome                             |
| event       | What happened (brief), why it mattered (bulk), consequences     |
| philosophy  | The thesis, how it developed, where it succeeded/failed         |
| pattern     | The trigger, the cycle, attempts to break it                    |
| transition  | What ended, the drift, what emerged                             |
| decision    | The situation, the options, the reasoning, the choice           |
| era         | The setting, the project, the team, the emotional tenor         |

## Article Rules
- Minimum 15 lines per article. No stubs.
- If a subtopic is getting its third paragraph in an existing article, it probably deserves its own page.
- Named entities that appear across multiple entries deserve their own pages.
- Every page you touch must get meaningfully richer, not just longer.

## Directory Taxonomy

### Core
| Directory       | What goes here                              |
|-----------------|---------------------------------------------|
| people/         | Named individuals                           |
| projects/       | Things built with serious commitment        |
| places/         | Cities, buildings, neighborhoods            |
| events/         | Specific dated occurrences                  |

### Inner Life and Patterns
| Directory       | What goes here                              |
|-----------------|---------------------------------------------|
| patterns/       | Recurring behavioral cycles                 |
| philosophies/   | Articulated intellectual positions           |
| decisions/      | Inflection points with reasoning            |
| eras/           | Major biographical phases                   |

### Relationships
| Directory       | What goes here                              |
|-----------------|---------------------------------------------|
| relationships/  | Dynamics between people                     |
| mentorships/    | Knowledge-transfer relationships            |
| communities/    | Online/offline communities                  |

### Work and Strategy
| Directory       | What goes here                              |
|-----------------|---------------------------------------------|
| strategies/     | Named strategies                            |
| techniques/     | Technical systems                           |
| skills/         | Competencies developed                      |
| ideas/          | Unrealized concepts                         |
| artifacts/      | Documents, plans, spreadsheets              |

### Narrative Structure
| Directory       | What goes here                              |
|-----------------|---------------------------------------------|
| transitions/    | Liminal periods between commitments         |
| experiments/    | Time-boxed tests with hypothesis and result |
| setbacks/       | Adverse incidents                           |

### Other
| Directory       | What goes here                              |
|-----------------|---------------------------------------------|
| restaurants/    | Eating/drinking places tied to moments      |
| health/         | Medical situations, wellbeing               |
| routines/       | Daily/weekly schedules                      |
| metaphors/      | Figurative frameworks                       |
| assessments/    | Self-evaluations                            |
| touchstones/    | Cultural encounters that triggered reflection |
| identities/     | Self-concepts or role labels                |

Create new directories freely when a type does not fit existing ones.

## Frontmatter Format
\`\`\`yaml
---
title: Article Title
type: person | project | place | concept | event | pattern | philosophy | decision | era | relationship | idea | transition | experiment | setback | mentorship | community | strategy | technique | skill | artifact | restaurant | health | routine | metaphor | assessment | touchstone | identity
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
related:
  - "[[Other Article]]"
  - "[[Another]]"
sources:
  - "entry_id_1"
  - "entry_id_2"
---
\`\`\`

Required fields: title, type, created, last_updated, related, sources

## Index Format
Each index entry should have an \`also:\` field listing alternative names and aliases. This helps match entry text to existing articles. Example:
\`\`\`
- [[people/john-doe|John Doe]] also: JD, Johnny, "the tall guy"
\`\`\`

## Article Lifecycle
- A page is created when there is enough material to write 15+ meaningful lines.
- A page is split when a subtopic within it grows to three or more paragraphs.
- Named entities appearing across 2+ entries deserve their own page.
- Concept articles emerge from patterns across entries: tensions, philosophies, recurring themes.

## Link Conventions
- Use [[wikilinks]] for all cross-references.
- Prefer display names: [[people/john-doe|John Doe]]
- No page is an island. Every article should link to at least 2 others.
`;

export function ensureSchema(wikiDir: string): void {
  const schemaPath = path.join(wikiDir, '_schema.md');
  if (!fs.existsSync(schemaPath)) {
    fs.writeFileSync(schemaPath, DEFAULT_SCHEMA, 'utf-8');
  }
}

export function loadSchema(wikiDir: string): string {
  const schemaPath = path.join(wikiDir, '_schema.md');
  if (!fs.existsSync(schemaPath)) {
    ensureSchema(wikiDir);
  }
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const identityBlock = buildSubjectIdentityBlock();
  if (identityBlock) {
    return identityBlock + '\n' + schema;
  }
  return schema;
}
