# Token Ops: AI Token Saver

Stop Cursor from wasting tokens on broad repo reads.

Token Ops runs locally in Cursor and gives the agent a compact task-focused context pack before it explores your repository. It also shows an estimated saved-token report, so users can see the benefit without learning MCP, graphs, or terminal commands.

## Why Install

- Install once, keep coding normally
- No API key required
- No account required
- No cloud backend
- No telemetry by default
- Local MCP server managed by Cursor
- Simple saved-token reports

## What Users Can Ask

```text
Use Token Ops before changing this code.
```

```text
Show my Token Ops savings report.
```

```text
Which files are expensive for Cursor to read?
```

## Included Tools

- `build_compact_context`: Creates a small task-focused context pack
- `estimate_context_cost`: Estimates selected-file and whole-repo token cost
- `list_high_cost_files`: Lists expensive files before opening them
- `report_saved_tokens`: Shows the local saved-token report

## Privacy

Token Ops runs locally. It does not require an API key or user account, and source code does not leave the user's machine by default.
