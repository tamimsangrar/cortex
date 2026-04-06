# Cortex MCP Server

An MCP (Model Context Protocol) server that gives any LLM agent read access
to your Cortex wiki and imported sources. Works with Claude Code, Cursor,
GitHub Copilot, and any other MCP-compatible client.

The server reads directly from `~/BrainDump` on disk. The Cortex Electron app
does **not** need to be running.

## Available tools

| Tool | Description |
|------|-------------|
| `search_wiki` | Full-text search across all wiki articles |
| `read_article` | Read a specific wiki article by path |
| `list_articles` | List all articles, optionally filtered by type |
| `read_index` | Read the wiki index (`_index.md`) |
| `list_sources` | List raw imported entries, optionally filtered by source type |
| `read_source` | Read a specific raw entry by path |
| `search_sources` | Full-text search across raw entries |
| `get_wiki_stats` | Article count, source count, categories |

## Setup

### Prerequisites

```bash
cd /path/to/braindump
npm install
```

### Claude Code

Add to your Claude Code MCP config (`.claude/mcp.json` or project settings):

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["tsx", "/path/to/braindump/mcp/server.ts"],
      "env": {
        "CORTEX_DATA_DIR": "~/BrainDump"
      }
    }
  }
}
```

### Cursor

Open **Settings > MCP Servers** and add:

```json
{
  "cortex": {
    "command": "npx",
    "args": ["tsx", "/path/to/braindump/mcp/server.ts"],
    "env": {
      "CORTEX_DATA_DIR": "~/BrainDump"
    }
  }
}
```

### GitHub Copilot (VS Code)

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "cortex": {
      "command": "npx",
      "args": ["tsx", "/path/to/braindump/mcp/server.ts"],
      "env": {
        "CORTEX_DATA_DIR": "~/BrainDump"
      }
    }
  }
}
```

### Other MCP clients

The server communicates via stdio (JSON-RPC over stdin/stdout). Point any
MCP-compatible client at:

```
npx tsx /path/to/braindump/mcp/server.ts
```

## Configuration

Set `CORTEX_DATA_DIR` to override the default data directory (`~/BrainDump`).

## Testing

Send an initialize request to verify the server starts:

```bash
echo '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | npx tsx mcp/server.ts
```

You should see a JSON response containing `serverInfo` with name `cortex`.
