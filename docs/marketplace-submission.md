# Cursor Marketplace Submission Checklist

Paste-ready text and a checklist for submitting Token Ops to the Cursor Marketplace via <https://cursor.com/marketplace/publish>.

## Pre-flight (already done)

- [x] Repository is **public** at <https://github.com/maikoo811/token-ops>
- [x] License: **MIT** (LICENSE file at repo root, GitHub auto-detected)
- [x] Manifest at `.cursor-plugin/plugin.json` matches the [official schema](https://cursor.com/schemas/cursor-plugin/plugin.json)
- [x] Logo at `assets/avatar.png` (512×512 PNG)
- [x] README with measured savings, install instructions, and verification steps
- [x] CHANGELOG.md tracking versions back to 0.2.0
- [x] CI workflow (`npm test` on Node 18 / 20 / 22)
- [x] Local test symlink installed at `~/.cursor/plugins/local/token-ops` — verify it loads in Cursor before submitting

## Submission form — paste-ready content

### Plugin name
```
token-ops
```

### Display name
```
Token Ops: AI Token Saver
```

### Short description (≤ 160 chars)
```
Stop Cursor and Claude Code from wasting tokens on broad repo reads. Runs locally with no API key, no account, no cloud backend.
```

### Long description / README
The `README.md` already covers what Marketplace listings expect:
- Beginner Defaults section
- Measured Savings (Mermaid chart + table + verification steps)
- Install instructions for Cursor, Claude Code, Codex
- MCP tools list
- Privacy and CLI usage

GitHub URL: <https://github.com/maikoo811/token-ops>

### Category
```
developer-tools
```

### Tags
```
tokens, context, mcp, productivity, agents
```

### Keywords
```
tokens, context, cursor, claude-code, mcp, vibe-coding
```

### Author
- Name: Maiko Kojima
- Email: 694169+maikoo811@users.noreply.github.com (GitHub noreply)

### Repository URL
```
https://github.com/maikoo811/token-ops
```

### Version (current release)
```
0.3.1
```

### Privacy posture (mention in description)
- Local MCP server (stdio)
- No API key required
- No account required
- No telemetry by default
- Reports written only to `.token-ops/session.jsonl` inside the user's repo

## Local verification before submission

```sh
# 1. Confirm symlink is in place
ls -la ~/.cursor/plugins/local/token-ops

# 2. Restart Cursor or run: Cmd+Shift+P → "Developer: Reload Window"

# 3. Inside Cursor, verify:
#    - Token Ops appears in the plugins list
#    - The token-ops rule is active
#    - MCP tools (build_compact_context, etc.) are callable from Cursor agent
```

## After submission

- Cursor team reviews each submission (timeline not publicly documented; expect days, not minutes)
- They may ask for changes — be ready to iterate on the manifest, README, or logo
- Updates also go through review, so batch them when possible
- When approved, the plugin will appear at `https://cursor.com/marketplace` and be installable in one click

## Useful links

- Submission form: <https://cursor.com/marketplace/publish>
- Schema: <https://cursor.com/schemas/cursor-plugin/plugin.json>
- Reference docs: <https://cursor.com/docs/reference/plugins>
- Example plugins (Cursor official): <https://github.com/cursor/plugins>
