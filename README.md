# Token Ops

Token Ops reduces wasted context during AI coding sessions. It gives Cursor, Claude Code, Codex, and other MCP-compatible agents a compact task-focused context pack before they read broadly, then records an estimated saved-token report.

The product goal is simple: install once, vibe code normally, and see how much context the agent avoided.

## Measured Savings

These are real numbers from running `token-ops pack` against this repository (17 tracked files, ~12,405 tokens of full-repo context):

| Task | Pack size | Vs selected full files | Vs whole repo |
|---|---|---|---|
| `Fix the CSV import bug` | ~2,271 tokens | **79% saved** | 82% saved |
| `Add OAuth login flow` | ~1,636 tokens | 38% saved | **87% saved** |
| `認証エラーの修正` | ~3,329 tokens | 65% saved | **73% saved** |

Focused bug-fix tasks get the largest savings because Token Ops can pick a small set of relevant files. Broader feature work saves less per pack but still avoids most of the whole-repo cost.

Run `token-ops report` in your own repo to see your cumulative savings after a few prompts.

## Beginner Defaults

Token Ops is designed to be useful without setup:

- No API key
- No account
- No cloud backend
- No telemetry by default
- Local MCP server
- Beginner defaults: 6 files, 80 snippet lines per file, auto language

## Cursor Plugin

Token Ops is being shaped for Cursor Marketplace distribution as a free local plugin.

The plugin includes:

- A local MCP server: `mcp/server.js`
- Cursor rules: `rules/token-ops.mdc`
- A Token Ops skill: `skills/token-ops/SKILL.md`
- Commands for compact context and saved-token reports

The MCP server runs locally. It does not require a hosted backend or a Token Ops account.

After installation, users can ask Cursor:

```text
Show my Token Ops savings report.
```

```text
Use Token Ops before changing this code.
```

```text
Which files are expensive for Cursor to read?
```

## MCP Tools

- `build_compact_context`: create a small task-focused context pack
- `estimate_context_cost`: estimate selected-file and whole-repo context cost
- `list_high_cost_files`: find tracked files that are expensive to put in context
- `report_saved_tokens`: show the local saved-token report

## CLI Install

From this repository:

```sh
npm install -g .
```

Or run without installing:

```sh
npx . pack "Fix the CSV import bug"
```

## CLI Usage

Inside any git project:

```sh
token-ops pack "Fix the CSV import bug"
```

Write the pack to a file:

```sh
token-ops pack "Improve auth error handling" -o context-pack.md
```

Show the saved-token report:

```sh
token-ops report
```

Find large tracked text files:

```sh
token-ops high-cost-files --limit 12
```

Estimate context cost for a task:

```sh
token-ops cost "Add tests for billing webhooks"
```

## One-command Editor Setup

Install project-local helpers:

```sh
token-ops install
```

This creates:

- `.claude/skills/token-ops/SKILL.md`
- `.claude/settings.local.json`
- `.cursor/rules/token-ops.mdc`
- `AGENTS.md`

Install only one integration:

```sh
token-ops install claude
token-ops install claude-hook
token-ops install cursor
token-ops install codex
```

## Local MCP Server

For advanced users who want to wire Token Ops manually:

```sh
token-ops-mcp
```

The package also exposes the server at:

```sh
node mcp/server.js
```

Cursor-compatible local MCP template:

```json
{
  "mcpServers": {
    "token-ops": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp/server.js"]
    }
  }
}
```

## What It Includes

Each context pack includes:

- Git branch and changed files
- Relevant files selected from task keywords
- Snippets around keyword matches
- Rough token estimates
- Estimated saved tokens versus selected full files and whole-repo context

## Roadmap

- Cursor Marketplace review metadata
- One-click Cursor installation flow
- Pre-read guard policies for generated files, lockfiles, and logs
- Code graph and impact analysis inspired by trace-mcp
- Multi-agent savings reports across Cursor, Codex, and Claude Code
