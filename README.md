# Token Ops

Token Ops reduces wasted context during AI coding sessions. It gives Cursor, Claude Code, Codex, and other MCP-compatible agents a compact task-focused context pack before they read broadly, then records an estimated saved-token report.

The product goal is simple: install once, vibe code normally, and see how much context the agent avoided.

## Measured Savings

This README, the v0.4.x release series, and the Cursor Marketplace submission package were all built in a single Claude Code session with the Token Ops `UserPromptSubmit` hook enabled in aggressive mode. The numbers below come from that real session — not from synthetic benchmarks. A reproducible script ([`docs/session-stats.mjs`](docs/session-stats.mjs)) reads `.token-ops/session.jsonl` and emits this exact table for any project that has used Token Ops for a while.

**Across 10 user prompts that triggered the hook, Token Ops avoided ~235,000 tokens of broader repo reads** — roughly $0.71 of Sonnet 4.5 input cost, or $3.53 of Opus 4.7 input cost, in a single ~4-hour development session.

### By prompt type

Prompt content is not disclosed — only the type of work each prompt represented.

```mermaid
---
config:
  xyChart:
    width: 760
    height: 320
  themeVariables:
    xyChart:
      plotColorPalette: "#16a34a"
---
xychart-beta
  title "Median tokens saved per prompt type (vs whole-repo)"
  x-axis ["Bug fix", "Question", "Decision", "Diagnosis", "Other"]
  y-axis "Tokens saved" 0 --> 34000
  bar [10924, 23248, 29680, 21801, 30366]
```

| Prompt type | Count this session | Median pack | Median saved vs whole repo |
|---|---|---|---|
| Bug fix / task request | 3 | ~906 tokens | ~10,924 tokens |
| Question / clarification | 3 | ~2,967 tokens | ~23,248 tokens |
| Decision / verification | 2 | ~2,032 tokens | ~29,680 tokens |
| Diagnosis (pasted log) | 1 | ~2,926 tokens | ~21,801 tokens |
| Other | 1 | ~3,979 tokens | ~30,366 tokens |

A raw verbatim pack output (from one of the bug-fix prompts) is checked in at [docs/sample-pack.md](docs/sample-pack.md) so you can see exactly what Token Ops produces.

### What "saved" actually measures

- **Pack size** is a rough token estimate: `length / 4` for ASCII and `length / 1.5` for CJK characters, summed. BPE tokenizers split CJK more aggressively than ASCII, so a single ratio underestimates Japanese-heavy content.
- **Vs whole repo** compares against reading every tracked text file. This is an upper bound — a real agent wouldn't read everything, so treat this number as a ceiling, not a typical baseline.
- The per-type medians come from a small sample (1–3 firings per category in this one session). The aggregate **~235K tokens avoided** is the more stable number.

What this does NOT measure: whether the pack contained the right context, or how many follow-up reads the agent makes. Token Ops earns its keep when its snippets are sufficient for the task; it does not stop the agent from reading more when needed.

### Verify these numbers yourself

After installing the hook (`token-ops install claude-hook --trigger-mode aggressive`) and using Claude Code for an hour or so, run:

```sh
node /path/to/token-ops/docs/session-stats.mjs
```

inside your project. It re-derives the same table and aggregate from your own `.token-ops/session.jsonl`. The script has no external dependencies and works on Node 18+.

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

## Levels of Automation

Token Ops can run anywhere from "type a command every time" to "fires on every prompt automatically." Pick the level that matches the editor you use and how much per-project setup you want.

| Level | Editor | Setup | What happens per prompt |
|---|---|---|---|
| **★★★★ Pre-injection** | Claude Code | `token-ops install claude-hook` (once per project) | A `UserPromptSubmit` hook **physically prepends** a compact pack to every prompt. Strongest guarantee — works even if the model would otherwise ignore the tool. Add `--trigger-mode aggressive` to fire on every prompt (≥ 6 chars, non self-referential); the default `smart` only fires on coding-keyword prompts. |
| **★★★ One-click plugin** | Cursor (Marketplace) | One-click install once Token Ops is published to <https://cursor.com/marketplace> | Plugin bundles MCP server + `alwaysApply: true` rule. Agent is told to call `build_compact_context` first on every task. |
| **★★ Global rule** | Cursor (any version) | Paste the rule below into `Cursor Settings → Rules → User Rules` once | Same agent-side instruction as the plugin path, applies to every project without per-project install. |
| **★ Per-project rule** | Cursor | `token-ops install cursor` inside each project | Same rule, scoped to that project's `.cursor/rules/token-ops.mdc`. Use when you don't want a global default. |
| **Manual** | Any editor | None | Type `Use build_compact_context for: <task>` in chat each time. Fine for trying things out. |

### Picking a level

- **You only use Claude Code** → Level ★★★★. Strongest, simplest.
- **You only use Cursor** → Wait for ★★★ Marketplace install (one click), or do ★★ now (paste once).
- **Mixed editors** → ★★★★ for Claude Code, ★★ for Cursor.
- **One-off trial in a single repo** → Manual or ★.

### Global Cursor rule (copy-paste)

For Level ★★, paste this into `Cursor Settings → Rules → User Rules`:

```
Before broad repository exploration, large file reads, or noisy test-log analysis, use Token Ops if its MCP tools are available.

Prefer this order:
1. Call build_compact_context for the current task.
2. Use the returned snippets and token budget before reading more files.
3. Call list_high_cost_files before opening large files, generated files, lockfiles, or logs.
4. Call report_saved_tokens when the user asks about cost, tokens, usage, or savings.

Avoid reading broad repository context until Token Ops output is insufficient for the task.
```

And add Token Ops as an MCP server in `~/.cursor/mcp.json` (one time):

```json
{
  "mcpServers": {
    "token-ops": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/token-ops/mcp/server.js"]
    }
  }
}
```

> Use an absolute path to `node` — Cursor GUI subprocesses do not inherit nvm's `PATH`.

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

Remove the helpers if you want to clean up:

```sh
token-ops uninstall
```

`uninstall` is non-destructive: it only removes the files and JSON keys
Token Ops added. Unrelated `.claude/settings.local.json` entries,
`AGENTS.md` content, and `.cursor/rules` files are preserved.

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
