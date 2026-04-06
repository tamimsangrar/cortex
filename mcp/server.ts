/**
 * MCP stdio server — exposes Cortex wiki and sources as tools over stdin/stdout.
 * Used by MCP-compatible AI assistants (Claude, etc.) to read the knowledge wiki.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  searchWiki,
  readArticle,
  listArticles,
  readIndex,
  listSources,
  readSource,
  searchSources,
  getWikiStats,
} from './tools.js';

const server = new Server(
  { name: 'cortex', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_wiki',
      description:
        'Search across all wiki articles by keyword. Returns matching articles with relevance scores and text snippets.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query (one or more keywords)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'read_article',
      description:
        'Read the full content of a specific wiki article by its path (e.g. "people/john-doe.md").',
      inputSchema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: 'Relative path within the wiki directory' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_articles',
      description:
        'List all wiki articles with metadata. Optionally filter by article type (person, project, place, concept, etc.).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: {
            type: 'string',
            description: 'Optional article type filter (e.g. person, project, place, concept, event, pattern, philosophy, decision, era, relationship, idea)',
          },
        },
      },
    },
    {
      name: 'read_index',
      description: 'Read the wiki index (_index.md), which lists all articles organized by category.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'list_sources',
      description:
        'List all raw source entries imported into Cortex. Optionally filter by source type (imessage, whatsapp, notion, obsidian, apple-notes, web-clip).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          source_type: {
            type: 'string',
            description: 'Optional source type filter (e.g. imessage, whatsapp, notion, obsidian, apple-notes, web-clip)',
          },
        },
      },
    },
    {
      name: 'read_source',
      description:
        'Read the full content of a specific raw source entry by its path within raw/entries/.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: 'Relative path within the raw/entries directory' },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_sources',
      description:
        'Search across all raw source entries by keyword. Returns matching entries with relevance scores and text snippets.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query (one or more keywords)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_wiki_stats',
      description:
        'Get statistics about the wiki: article count, source count, last compiled date, and top categories.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let text: string;

    switch (name) {
      case 'search_wiki':
        text = searchWiki(String(args?.query ?? ''));
        break;
      case 'read_article':
        text = readArticle(String(args?.path ?? ''));
        break;
      case 'list_articles':
        text = listArticles(args?.type ? String(args.type) : undefined);
        break;
      case 'read_index':
        text = readIndex();
        break;
      case 'list_sources':
        text = listSources(args?.source_type ? String(args.source_type) : undefined);
        break;
      case 'read_source':
        text = readSource(String(args?.path ?? ''));
        break;
      case 'search_sources':
        text = searchSources(String(args?.query ?? ''));
        break;
      case 'get_wiki_stats':
        text = getWikiStats();
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return { content: [{ type: 'text', text }] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
